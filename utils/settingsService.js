const AppSettings = require('../models/AppSettings');
const { DEFAULT_BULK_CONCURRENCY, sanitizeBulkConcurrency } = require('./concurrency');

function cleanUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';

    try {
        const url = new URL(trimmed);
        if (!['http:', 'https:'].includes(url.protocol)) return '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return '';
    }
}

function defaultSettings() {
    return {
        verifierEngine: (process.env.VERIFIER_ENGINE || 'truemail').toLowerCase(),
        goVerifierUrl: cleanUrl(process.env.GO_VERIFIER_URL || 'http://localhost:8082'),
        reacherUrl: cleanUrl(process.env.REACHER_URL || 'http://localhost:8081'),
        smtpProxy: process.env.SMTP_PROXY || '',
        bulkConcurrency: sanitizeBulkConcurrency(process.env.BULK_CONCURRENCY, DEFAULT_BULK_CONCURRENCY),
        reacherTimeoutMs: parseInt(process.env.REACHER_TIMEOUT_MS || '45000', 10),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        groqApiKey: process.env.GROQ_API_KEY || '',
        openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
        aiProvider: (process.env.AI_PROVIDER || 'groq').toLowerCase(),
        aiModel: process.env.AI_MODEL || '',
        autoRedirectAfterVerify: true,
        canSpamAddress: '',
        appendCanSpamFooter: false,
        maxSendsPerHour: 0,
        senderFailurePausePercent: 25,
        savePartialOnPause: true,
    };
}

function sanitizeSettings(input = {}) {
    const defaults = defaultSettings();
    const allowedEngines = ['auto', 'truemail', 'reacher'];
    const verifierEngine = String(input.verifierEngine || defaults.verifierEngine || 'truemail').toLowerCase();
    const bulkConcurrency = parseInt(input.bulkConcurrency ?? defaults.bulkConcurrency, 10);
    const reacherTimeoutMs = parseInt(input.reacherTimeoutMs ?? defaults.reacherTimeoutMs, 10);

    return {
        verifierEngine: allowedEngines.includes(verifierEngine) ? verifierEngine : 'truemail',
        goVerifierUrl: cleanUrl(input.goVerifierUrl ?? defaults.goVerifierUrl),
        reacherUrl: cleanUrl(input.reacherUrl ?? defaults.reacherUrl),
        smtpProxy: String(input.smtpProxy ?? defaults.smtpProxy ?? '').trim(),
        bulkConcurrency: sanitizeBulkConcurrency(bulkConcurrency, DEFAULT_BULK_CONCURRENCY),
        reacherTimeoutMs: Number.isFinite(reacherTimeoutMs) ? Math.min(Math.max(reacherTimeoutMs, 5000), 180000) : 45000,
        openaiApiKey: String(input.openaiApiKey ?? defaults.openaiApiKey ?? '').trim(),
        groqApiKey: String(input.groqApiKey ?? defaults.groqApiKey ?? '').trim(),
        openrouterApiKey: String(input.openrouterApiKey ?? defaults.openrouterApiKey ?? '').trim(),
        aiProvider: ['groq', 'openai', 'openrouter'].includes(String(input.aiProvider || defaults.aiProvider).toLowerCase())
            ? String(input.aiProvider || defaults.aiProvider).toLowerCase()
            : 'groq',
        aiModel: String(input.aiModel ?? defaults.aiModel ?? '').trim(),
        autoRedirectAfterVerify: input.autoRedirectAfterVerify !== false,
        canSpamAddress: String(input.canSpamAddress ?? defaults.canSpamAddress ?? '').trim(),
        appendCanSpamFooter: input.appendCanSpamFooter === true,
        maxSendsPerHour: Math.max(0, parseInt(input.maxSendsPerHour ?? defaults.maxSendsPerHour ?? 0, 10) || 0),
        senderFailurePausePercent: Math.min(100, Math.max(0, parseInt(input.senderFailurePausePercent ?? defaults.senderFailurePausePercent ?? 25, 10) || 25)),
        savePartialOnPause: input.savePartialOnPause !== false,
    };
}

async function getSettingsForUser(userId) {
    const defaults = defaultSettings();
    if (!userId) return defaults;

    const saved = await AppSettings.findOne({ user: userId }).lean();
    if (!saved) return defaults;

    const merged = { ...defaults, ...saved };
    if (saved.bulkConcurrency === 3) {
        merged.bulkConcurrency = defaults.bulkConcurrency;
    }

    return sanitizeSettings(merged);
}

async function saveSettingsForUser(userId, input) {
    const existing = await AppSettings.findOne({ user: userId }).lean();
    const merged = { ...defaultSettings(), ...(existing || {}), ...input };
    if (!input.openaiApiKey && existing?.openaiApiKey) {
        merged.openaiApiKey = existing.openaiApiKey;
    }
    if (!input.groqApiKey && existing?.groqApiKey) {
        merged.groqApiKey = existing.groqApiKey;
    }
    if (!input.openrouterApiKey && existing?.openrouterApiKey) {
        merged.openrouterApiKey = existing.openrouterApiKey;
    }
    const settings = sanitizeSettings(merged);
    const saved = await AppSettings.findOneAndUpdate(
        { user: userId },
        { $set: settings },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return sanitizeSettings(saved);
}

module.exports = {
    defaultSettings,
    getSettingsForUser,
    saveSettingsForUser,
    sanitizeSettings,
};
