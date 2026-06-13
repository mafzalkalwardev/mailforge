/**
 * Strict SMTP response interpretation — overrides engine "valid" when response text proves failure.
 */

const REJECT_CODE_RE = /\b(550|551|552|553|554|503|521|522|571|572|554)\b/;

const BLOCKED_PHRASES = [
    'service unavailable',
    'access denied',
    'client host',
    'sender address rejected',
    'does not accept mail',
    'nullmx',
    'blocked',
    'reject',
    'tss09',
    'tss11',
    'spamhaus',
    'blacklist',
    'not permitted',
    'relay access denied',
];

const MAILBOX_GONE_PHRASES = [
    'user unknown',
    'mailbox not found',
    'does not exist',
    'no such user',
    'invalid recipient',
    'recipient address rejected',
    'unknown user',
    'account disabled',
    'disabled',
];

function applySmtpResponseRules(report) {
    if (!report || typeof report !== 'object') return report;

    const smtp = String(report.smtp_response || report.smtpResponse || '').trim();
    if (!smtp) return report;

    const lower = smtp.toLowerCase();
    const hasRejectCode = REJECT_CODE_RE.test(lower);
    const hasBlockedPhrase = BLOCKED_PHRASES.some(p => lower.includes(p));
    const hasMailboxGone = MAILBOX_GONE_PHRASES.some(p => lower.includes(p));

    // Clear positive SMTP proof — 250 without accompanying reject codes
    const has250 = /\b250\b/.test(lower);
    const smtpProvesValid = has250 && !hasRejectCode && !hasBlockedPhrase;

    if (smtpProvesValid) {
        return { ...report, valid: true, mailbox_verified: 'yes' };
    }

    if (hasRejectCode || hasBlockedPhrase || hasMailboxGone) {
        const updated = { ...report, valid: false };

        if (hasMailboxGone || (hasRejectCode && !hasBlockedPhrase)) {
            updated.mailbox_verified = 'no';
            updated.status = 'invalid';
        } else {
            // IP blocked / sender rejected — cannot confirm mailbox
            updated.mailbox_verified = 'unknown';
            updated.status = 'unknown';
        }

        if (!updated.verdict_summary || updated.valid === false) {
            const preview = smtp.length > 80 ? smtp.slice(0, 80) + '…' : smtp;
            updated.verdict_summary = `${updated.email || report.email || ''} — not valid (${preview})`;
        }

        return updated;
    }

    return report;
}

module.exports = { applySmtpResponseRules, REJECT_CODE_RE, BLOCKED_PHRASES };
