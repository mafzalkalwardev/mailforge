const axios = require('axios');
const { mapReacherToReport, checkReacherHealth, REACHER_BASE } = require('./reacherClient');
const { ensureGoVerifier } = require('./spawnGo');
const { getSettingsForUser } = require('./settingsService');
const { applySmtpResponseRules, mapStatus } = require('./smtpResponseRules');
const { checkSmtpPath } = require('./smtpHealth');

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const engineCache = new Map();

function cacheKey(userId) {
    return userId ? String(userId) : 'default';
}

function isLocalUrl(url) {
    try {
        const parsed = new URL(url);
        return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    } catch {
        return false;
    }
}

function normalizeBase(url, fallback) {
    return String(url || fallback || '').replace(/\/$/, '');
}

function defaultGoBase() {
    return normalizeBase(process.env.GO_VERIFIER_URL, 'http://localhost:8082');
}

async function settingsFor(userId) {
    return getSettingsForUser(userId);
}

function verifierRequestHeaders(settings = {}) {
    const headers = {};
    const proxy = String(settings.smtpProxy || process.env.SMTP_PROXY || '').trim();
    if (proxy) headers['X-Mailforge-Smtp-Proxy'] = proxy;
    const helo = String(process.env.SMTP_HELO || process.env.SMTP_EHLO || '').trim();
    if (helo) headers['X-Mailforge-Smtp-Helo'] = helo;
    const from = String(process.env.SMTP_FROM || process.env.VERIFIER_EMAIL || '').trim();
    if (from) headers['X-Mailforge-Smtp-From'] = from;
    return headers;
}

async function verifyWithGo(email, settings = {}) {
    const goBase = normalizeBase(settings.goVerifierUrl, defaultGoBase());
    const url = `${goBase}/v1/${encodeURIComponent(email)}/verification`;
    const { data } = await axios.get(url, {
        timeout: 120000,
        headers: verifierRequestHeaders(settings),
    });
    return { ...data, engine: data.engine || 'truemail-go' };
}

function wrapResult(report, email) {
    const normalized = applySmtpResponseRules({ ...report, email: report.email || email });
    const status = mapStatus(normalized);
    const stored = { ...normalized, status };
    return {
        email: stored.email || email,
        domain_valid: stored.domain_valid,
        mailbox_verified: stored.mailbox_verified,
        valid: stored.valid,
        checks: stored.checks || [],
        mx_records: stored.mx_records || [],
        misc: stored.misc || {},
        smtp_host: stored.smtp_host || '',
        smtp_response: stored.smtp_response || '',
        verdict_summary: stored.verdict_summary || '',
        syntax_valid: stored.syntax_valid,
        smtp_check_ran: stored.smtp_check_ran,
        engine: stored.engine || 'unknown',
        status,
        report: stored,
    };
}

async function isTruemailUp(settings = {}) {
    const goBase = normalizeBase(settings.goVerifierUrl, defaultGoBase());
    try {
        const { data } = await axios.get(`${goBase}/health`, { timeout: 3000 });
        return data?.status === 'ok';
    } catch (_) {
        return false;
    }
}

async function ensureTruemailReady(settings = {}) {
    const goBase = normalizeBase(settings.goVerifierUrl, defaultGoBase());
    if (await isTruemailUp(settings)) return true;

    if (!IS_SERVERLESS && isLocalUrl(goBase)) {
        await ensureGoVerifier();
        for (let i = 0; i < 15; i++) {
            if (await isTruemailUp(settings)) return true;
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    return isTruemailUp(settings);
}

async function resolveEngine(userId) {
    const settings = await settingsFor(userId);
    const key = cacheKey(userId);
    const mode = settings.verifierEngine || 'auto';

    if (mode === 'truemail' || mode === 'auto') {
        if (await ensureTruemailReady(settings)) {
            engineCache.set(key, 'truemail-go');
            return 'truemail-go';
        }

        if (mode === 'auto' && await checkReacherHealth(settings.reacherUrl)) {
            engineCache.set(key, 'reacher');
            return 'reacher';
        }

        throw new Error(
            IS_SERVERLESS
                ? 'No hosted verifier is online. Add a public truemail-go or Reacher URL in Settings.'
                : 'truemail-go is not running. Restart with npm start or configure a hosted verifier URL in Settings.'
        );
    }

    if (mode === 'reacher') {
        if (await checkReacherHealth(settings.reacherUrl)) {
            engineCache.set(key, 'reacher');
            return 'reacher';
        }

        if (await ensureTruemailReady(settings)) {
            engineCache.set(key, 'truemail-go');
            return 'truemail-go';
        }

        throw new Error('Reacher is unavailable and no truemail-go fallback is online.');
    }

    if (engineCache.has(key)) return engineCache.get(key);
    throw new Error('No verifier available.');
}

async function verifyWithReacherTimed(email, settings = {}) {
    const body = {
        to_email: email,
        hello_name: process.env.SMTP_HELO || process.env.SMTP_EHLO || 'mailforge.local',
    };
    if (settings.smtpProxy) {
        try {
            const u = new URL(settings.smtpProxy);
            body.proxy = {
                host: u.hostname,
                port: parseInt(u.port || '1080', 10),
                username: u.username || undefined,
                password: u.password || undefined,
            };
        } catch (_) {}
    }

    const reacherUrl = normalizeBase(settings.reacherUrl, REACHER_BASE);
    const { data } = await axios.post(`${reacherUrl}/v0/check_email`, body, {
        timeout: settings.reacherTimeoutMs || 45000,
    });
    return mapReacherToReport(data, email);
}

async function verifyEmailCombined(email, userId) {
    const settings = await settingsFor(userId);
    const engine = await resolveEngine(userId);
    let report;

    try {
        if (engine === 'reacher') {
            report = await verifyWithReacherTimed(email, settings);
        } else {
            report = await verifyWithGo(email, settings);
        }
    } catch (primaryErr) {
        const failedReacher = engine === 'reacher';
        const canFallback =
            failedReacher &&
            (primaryErr.code === 'ECONNABORTED' || String(primaryErr.message).includes('timeout'));

        if (canFallback || failedReacher) {
            if (await ensureTruemailReady(settings)) {
                console.warn(`Reacher failed for ${email}; using truemail-go`);
                report = await verifyWithGo(email, settings);
                report.engine = 'truemail-go';
                report.fallback_from = 'reacher';
            } else {
                throw new Error(`Reacher failed: ${primaryErr.message}. truemail-go is not online.`);
            }
        } else {
            throw new Error(`truemail-go failed: ${primaryErr.message}`);
        }
    }

    return wrapResult(report, email);
}

async function checkBackendHealth(userId) {
    const settings = await settingsFor(userId);
    const goBase = normalizeBase(settings.goVerifierUrl, defaultGoBase());
    const reacherUrl = normalizeBase(settings.reacherUrl, REACHER_BASE);
    const health = {
        go: false,
        reacher: false,
        engine: null,
        active_engine: null,
        smtp_port: null,
        go_url: goBase,
        reacher_url: reacherUrl,
        mode: settings.verifierEngine || 'auto',
        serverless: IS_SERVERLESS,
        settings,
    };

    try {
        const { data } = await axios.get(`${goBase}/health`, { timeout: 5000 });
        health.go = data?.status === 'ok';
        health.smtp_port = data?.smtp_port || null;
        if (health.go) health.engine = data?.engine || 'truemail-go';
    } catch (_) {}

    health.reacher = await checkReacherHealth(reacherUrl);
    health.smtp = await checkSmtpPath({
        proxy: settings.smtpProxy || process.env.SMTP_PROXY || '',
    });

    try {
        health.active_engine = await resolveEngine(userId);
    } catch (_) {
        health.active_engine = health.go ? 'truemail-go' : health.reacher ? 'reacher' : null;
    }

    return health;
}

function resetEngineCache(userId) {
    if (userId) {
        engineCache.delete(cacheKey(userId));
        return;
    }
    engineCache.clear();
}

module.exports = {
    verifyEmailCombined,
    checkBackendHealth,
    verifyWithGo,
    verifierRequestHeaders,
    GO_BASE: defaultGoBase(),
    mapStatus,
    resolveEngine,
    resetEngineCache,
};
