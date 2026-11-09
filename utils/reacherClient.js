const axios = require('axios');

const REACHER_BASE = (process.env.REACHER_URL || 'http://localhost:8081').replace(/\/$/, '');

function isErrorBlock(obj) {
    return obj && typeof obj === 'object' && obj.type === 'error';
}

function mapReacherToReport(data, email) {
    const syntax = data.syntax || {};
    const mx = isErrorBlock(data.mx) ? {} : data.mx || {};
    const smtp = isErrorBlock(data.smtp) ? {} : data.smtp || {};
    const misc = isErrorBlock(data.misc) ? {} : data.misc || {};

    const syntaxValid = syntax.is_valid_syntax !== false;
    const mxRecords = (mx.records || []).map((host, i) => ({
        host: String(host).replace(/\.$/, ''),
        priority: (i + 1) * 10,
    }));

    const disposable = !!misc.is_disposable;
    const checks = [];

    checks.push({
        step: 'syntax',
        passed: syntaxValid,
        message: syntaxValid
            ? 'The Email Address Syntax is correct'
            : 'The Email Address Syntax is incorrect',
    });

    if (disposable) {
        checks.push({ step: 'misc', passed: false, message: 'Disposable / temporary email domain detected' });
    } else {
        checks.push({ step: 'misc', passed: true, message: 'Not a known disposable domain' });
    }
    if (misc.is_role_account) {
        checks.push({ step: 'misc', passed: false, message: 'Role-based email account' });
    }

    if (!mx.accepts_mail || mxRecords.length === 0) {
        checks.push({ step: 'mx', passed: false, message: 'No MX records found for domain' });
    } else {
        mxRecords.forEach(mx => {
            checks.push({
                step: 'mx',
                passed: true,
                message: `MX record found: ${mx.host} (Priority ${mx.priority})`,
            });
        });
    }

    const smtpRan = smtp.can_connect_smtp === true;
    const deliverable = smtp.is_deliverable === true;
    const catchAll = smtp.is_catch_all === true;
    const reachable = data.is_reachable || 'unknown';
    const smtpError = isErrorBlock(data.smtp);

    if (smtpRan || smtpError) {
        checks.push({
            step: 'smtp',
            passed: deliverable && !catchAll && !smtpError,
            message: catchAll
                ? 'Domain accepts all recipients (catch-all)'
                : deliverable
                    ? 'SMTP mailbox confirmed (Reacher)'
                    : 'SMTP mailbox not confirmed (Reacher)',
            detail: `is_reachable: ${reachable}`,
        });
    }

    const domainValid = syntaxValid && mx.accepts_mail && !disposable;

    let mailboxVerified = 'unknown';
    if (catchAll) {
        mailboxVerified = 'catch_all';
    } else if (smtpRan && deliverable) {
        mailboxVerified = 'yes';
    } else if (reachable === 'invalid' && smtpRan) {
        mailboxVerified = 'no';
    } else if (!smtpRan || smtpError) {
        mailboxVerified = 'unknown';
    }

    const valid = mailboxVerified === 'yes';
    let verdictSummary = `${email} seems not to be valid`;
    if (catchAll) verdictSummary = `${email} — domain accepts all recipients (catch-all / risky)`;
    else if (valid) verdictSummary = `${email} seems to be valid`;
    else if (!smtpRan || smtpError) {
        verdictSummary = `${email} — SMTP port 25 unreachable from this server`;
    }

    return {
        email: data.input || email,
        domain_valid: domainValid,
        mailbox_verified: mailboxVerified,
        valid,
        checks,
        mx_records: mxRecords,
        misc: {
            disposable,
            role_account: !!misc.is_role_account,
            free_provider: false,
            catch_all: catchAll,
        },
        smtp_host: mxRecords[0]?.host || '',
        smtp_response: catchAll
            ? 'catch-all'
            : smtpError
                ? 'SMTP port 25 unreachable from this server'
                : (smtpRan || reachable)
                    ? `is_reachable=${reachable}, is_deliverable=${deliverable}, is_catch_all=${catchAll}, can_connect_smtp=${smtpRan}`
                    : '',
        verdict_summary: verdictSummary,
        syntax_valid: syntaxValid,
        smtp_check_ran: smtpRan,
        engine: 'reacher',
        reacher_raw: data,
    };
}

function baseUrl(url) {
    return String(url || REACHER_BASE).replace(/\/$/, '');
}

async function checkReacherHealth(reacherUrl = REACHER_BASE) {
    try {
        const { data } = await axios.get(`${baseUrl(reacherUrl)}/version`, { timeout: 5000 });
        return !!data;
    } catch (_) {
        return false;
    }
}

async function verifyWithReacher(email, options = {}) {
    const proxy = options.smtpProxy || process.env.SMTP_PROXY;
    const body = {
        to_email: email,
        hello_name: process.env.SMTP_HELO || process.env.SMTP_EHLO || 'mailforge.local',
    };
    if (proxy) {
        try {
            const u = new URL(proxy);
            body.proxy = {
                host: u.hostname,
                port: parseInt(u.port || '1080', 10),
                username: u.username || undefined,
                password: u.password || undefined,
            };
        } catch (_) {}
    }

    const timeout = parseInt(options.timeoutMs || process.env.REACHER_TIMEOUT_MS || '45000', 10);
    const { data } = await axios.post(`${baseUrl(options.reacherUrl)}/v0/check_email`, body, {
        timeout,
    });
    return mapReacherToReport(data, email);
}

module.exports = {
    verifyWithReacher,
    checkReacherHealth,
    REACHER_BASE,
    mapReacherToReport,
};
