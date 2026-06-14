const SuppressedEmail = require('../models/SuppressedEmail');

async function isSuppressed(userId, email) {
    const normalized = String(email || '').toLowerCase().trim();
    if (!normalized) return false;
    const hit = await SuppressedEmail.findOne({ user: userId, email: normalized }).select('_id');
    return Boolean(hit);
}

async function addSuppression(userId, email, reason = 'manual', note = '') {
    const normalized = String(email || '').toLowerCase().trim();
    if (!normalized) return null;
    return SuppressedEmail.findOneAndUpdate(
        { user: userId, email: normalized },
        { reason, note },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
}

const BOUNCE_PATTERNS = [
    'user unknown',
    'mailbox not found',
    'does not exist',
    'no such user',
    'invalid recipient',
    '550',
    '551',
    '552',
    '553',
    '554',
    'account disabled',
    'address rejected',
];

function looksLikeBounce(errorText) {
    const lower = String(errorText || '').toLowerCase();
    return BOUNCE_PATTERNS.some(p => lower.includes(p));
}

module.exports = { isSuppressed, addSuppression, looksLikeBounce };
