/**
 * Strict SMTP response interpretation.
 * A result is valid only when an MX accepted RCPT TO. Connection failures,
 * timeouts, blocked port 25, and greylisting are unknown. Catch-all domains
 * are risky, never valid. A fabricated "250 OK" does not override a dial error.
 */

const REJECT_CODE_RE = /\b(550|551|552|553|554|503|521|522|571|572)\b/;
const PORT25_REASON = 'SMTP port 25 unreachable from this server';

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

const CONNECTION_RE = /i\/o timeout|dial tcp|connection refused|connection reset|network is unreachable|no route to host|context deadline exceeded|connectex|wsarecv|wsasend|smtp port 25 unreachable|proxyconnect|i\/o error|connection timed out/i;
const PROXY_FAILURE_RE = /smtp proxy unreachable|invalid smtp proxy/i;
const GREYLIST_RE = /\b(421|450|451|452)\b|greylist|grey-?list|graylist|try again later/i;
const CATCH_ALL_RE = /\bcatch[-_ ]?all\b|\baccept[-_ ]?all\b/i;

function evidenceText(report) {
    const parts = [report.smtp_response, report.smtpResponse, report.verdict_summary];
    for (const check of report.checks || []) {
        if (!check) continue;
        parts.push(check.message, check.detail);
    }
    return parts.filter(Boolean).join('\n');
}

function replaceSmtpCheck(checks, item) {
    const rest = (checks || []).filter(check => check && check.step !== 'smtp');
    rest.push(item);
    return rest;
}

function asUnknown(report, message, detail) {
    const email = report.email || '';
    const smtp = detail || message;
    return {
        ...report,
        valid: false,
        catch_all: false,
        mailbox_verified: 'unknown',
        status: 'unknown',
        smtp_response: smtp,
        verdict_summary: `${email} — ${message}`,
        checks: replaceSmtpCheck(report.checks, {
            step: 'smtp',
            passed: false,
            message,
            detail: smtp,
        }),
    };
}

function isCatchAllReport(report, text) {
    const mailbox = String(report.mailbox_verified || '').toLowerCase();
    const status = String(report.status || '').toLowerCase();
    if (report.catch_all === true || mailbox === 'catch_all' || status === 'risky' || status === 'catch_all') {
        return true;
    }
    return CATCH_ALL_RE.test(text || '');
}

function applySmtpResponseRules(report) {
    if (!report || typeof report !== 'object') return report;

    const text = evidenceText(report);
    const lower = text.toLowerCase();

    if (isCatchAllReport(report, text)) {
        const email = report.email || '';
        return {
            ...report,
            valid: false,
            catch_all: true,
            mailbox_verified: 'catch_all',
            status: 'risky',
            verdict_summary: report.verdict_summary && /catch-all|risky/i.test(report.verdict_summary)
                ? report.verdict_summary
                : `${email} is risky/catch-all — the domain accepts every recipient`,
            checks: replaceSmtpCheck(report.checks, {
                step: 'smtp',
                passed: false,
                message: 'Domain is catch-all / accept-all (risky)',
                detail: report.smtp_response || 'A random recipient was accepted',
            }),
        };
    }

    if (!text.trim()) return report;

    if (PROXY_FAILURE_RE.test(text)) {
        return asUnknown(report, 'SMTP proxy unreachable', report.smtp_response || text);
    }

    if (CONNECTION_RE.test(text)) {
        const dial = (text.match(/dial tcp[^\n]*/i) || [])[0];
        const detail = dial ? `${PORT25_REASON}: ${dial.trim()}` : PORT25_REASON;
        return asUnknown(report, PORT25_REASON, detail);
    }

    if (GREYLIST_RE.test(lower)) {
        return asUnknown(
            report,
            'could not verify (mail server asked us to try again later)',
            report.smtp_response || text
        );
    }

    const hasRejectCode = REJECT_CODE_RE.test(lower);
    const hasBlockedPhrase = BLOCKED_PHRASES.some(phrase => lower.includes(phrase));
    const hasMailboxGone = MAILBOX_GONE_PHRASES.some(phrase => lower.includes(phrase));
    const has250 = /\b250\b/.test(lower);
    const smtpProvesValid = has250 && !hasRejectCode && !hasBlockedPhrase;

    if (smtpProvesValid) {
        return {
            ...report,
            valid: true,
            catch_all: false,
            mailbox_verified: 'yes',
            status: 'valid',
        };
    }

    if (hasRejectCode || hasBlockedPhrase || hasMailboxGone) {
        const email = report.email || '';
        const previewSource = report.smtp_response || text;
        const preview = previewSource.length > 80 ? `${previewSource.slice(0, 80)}…` : previewSource;
        if (hasBlockedPhrase && !hasMailboxGone) {
            return asUnknown(report, 'could not verify (mail server blocked our IP / sender)', previewSource);
        }
        return {
            ...report,
            valid: false,
            catch_all: false,
            mailbox_verified: 'no',
            status: 'invalid',
            verdict_summary: `${email} — not valid (${preview})`,
        };
    }

    return report;
}

module.exports = {
    applySmtpResponseRules,
    REJECT_CODE_RE,
    BLOCKED_PHRASES,
    PORT25_REASON,
};
