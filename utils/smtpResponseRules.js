/**
 * Final SMTP verdicts.
 * Valid only after a real RCPT TO acceptance that is not catch-all.
 * Policy, rDNS/PTR, blocklists, greylisting, and connect failures are unknown.
 * Invalid is reserved for mailbox-level replies (5.1.1, user unknown, and similar).
 */

const MAILBOX_RE = /5\.1\.[0-3]|user unknown|unknown user|no such user|user not found|recipient unknown|mailbox unavailable|mailbox not found|mailbox does not exist|no such mailbox|invalid recipient|recipient invalid|invalid mailbox|account disabled|account does not exist|does not exist|no mailbox|mailbox unavailable/i;
const STRONG_MAILBOX_RE = /5\.1\.[0-3]|user unknown|unknown user|no such user|user not found|mailbox unavailable|mailbox not found|no such mailbox|does not exist|no mailbox/i;
const STRONG_POLICY_RE = /no smtp service|dns ptr|invalid dns ptr|ptr resource|\brdns\b|spamhaus|\bpbl\b/i;
const POLICY_RE = /client host|access denied|service unavailable|blacklist|blacklisted|blocked|not permitted|relay access denied|greylist|grey-?list|try again|poor reputation|sender address rejected|dnsbl|administrative prohibition|\b421\b|\b4\.7\.|\b5\.7\./i;
const DIAL_RE = /i\/o timeout|dial tcp|connection refused|connection reset|network is unreachable|no route to host|verification proxy offline|smtp port 25 unreachable|context deadline exceeded|wsarecv|proxy offline|no such host|dialog timed out/i;
const TEMP_OR_POLICY_CODE_RE = /\b(421|450|451|452|554)\b/;
const ACCEPT_RE = /\b250\b|\b2\.1\.5\b/;

function evidenceText(report) {
    const bits = [report?.smtp_response, report?.smtpResponse];
    for (const check of report?.checks || []) {
        if (!check) continue;
        if (!check.step || check.step === 'smtp') {
            bits.push(check.detail, check.message);
        }
    }
    return bits.filter(Boolean).join('\n');
}

function preview(text) {
    const one = String(text || '').replace(/\s+/g, ' ').trim();
    if (one.length <= 180) return one;
    return `${one.slice(0, 180)}…`;
}

function targetAccepted(text) {
    return ACCEPT_RE.test(text) && !MAILBOX_RE.test(text) && !STRONG_POLICY_RE.test(text) && !POLICY_RE.test(text);
}

// Catch-all is only the case where the target RCPT was accepted and the engine
// also accepted a random probe. The letters "catchall" inside an address or a
// 550 line are not a signal.
function isConfirmedCatchAll(report, text) {
    if (!targetAccepted(text)) return false;
    if (report?.misc?.catch_all || report?.misc?.catchAll) return true;
    const mailbox = String(report?.mailbox_verified || '').toLowerCase();
    return mailbox === 'catch_all' || mailbox === 'catchall' || mailbox === 'accept_all' || mailbox === 'accept-all';
}

function dialReason(text) {
    const lower = String(text || '').toLowerCase();
    if (lower.includes('verification proxy offline') || lower.includes('proxy offline')) {
        return 'verification proxy offline';
    }
    if (/\bproxy\b/.test(lower) && /refused|offline|unreachable|timed out|timeout/.test(lower)) {
        return 'verification proxy offline';
    }
    if (lower.includes('dialog timed out')) {
        return 'SMTP dialog timed out before a mailbox reply';
    }
    return 'SMTP port 25 unreachable from this server';
}

function withReason(original, reason) {
    const raw = String(original || '').trim();
    if (!raw) return reason;
    if (raw.toLowerCase().includes(String(reason).toLowerCase())) return raw;
    return `${reason}: ${raw}`;
}

function retargetSmtpChecks(checks, { passed, detail }) {
    if (!Array.isArray(checks)) return checks;
    return checks.map(check => {
        if (!check || check.step !== 'smtp') return check;
        return { ...check, passed, detail: detail || check.detail };
    });
}

function finish(report, patch) {
    const next = { ...report, ...patch };
    if (next.mailbox_verified !== 'catch_all') {
        next.misc = { ...(next.misc || {}), catch_all: false };
    }
    if (patch.mailbox_verified !== 'yes') {
        next.checks = retargetSmtpChecks(report.checks, { passed: false, detail: next.smtp_response });
    } else if (patch.smtp_response) {
        next.checks = retargetSmtpChecks(report.checks, { passed: true, detail: patch.smtp_response });
    }
    return next;
}

function applySmtpResponseRules(report) {
    if (!report || typeof report !== 'object') return report;

    const email = report.email || '';
    const rawSmtp = String(report.smtp_response || report.smtpResponse || '').trim();
    const text = evidenceText(report);
    const lower = text.toLowerCase();

    if (DIAL_RE.test(lower) && !STRONG_MAILBOX_RE.test(lower)) {
        const reason = dialReason(text);
        return finish(report, {
            valid: false,
            mailbox_verified: 'unknown',
            status: 'unknown',
            smtp_response: withReason(rawSmtp || text, reason),
            verdict_summary: `${email} — ${reason}`,
        });
    }

    if (STRONG_POLICY_RE.test(lower)) {
        return finish(report, {
            valid: false,
            mailbox_verified: 'unknown',
            status: 'unknown',
            smtp_response: rawSmtp || preview(text),
            verdict_summary: `${email} — could not verify (policy rejection, not a mailbox result): ${preview(rawSmtp || text)}`,
        });
    }

    const mailbox = MAILBOX_RE.test(lower);
    const policy = POLICY_RE.test(lower);
    if (mailbox && (!policy || STRONG_MAILBOX_RE.test(lower))) {
        return finish(report, {
            valid: false,
            mailbox_verified: 'no',
            status: 'invalid',
            smtp_response: rawSmtp || preview(text),
            verdict_summary: `${email} seems not to be valid`,
        });
    }

    if (policy || TEMP_OR_POLICY_CODE_RE.test(lower)) {
        const greylist = /\b421\b|greylist|grey-?list|try again|\b450\b|\b451\b/.test(lower);
        const why = greylist
            ? 'temporary SMTP failure / greylisting, not a mailbox result'
            : 'policy rejection, not a mailbox result';
        return finish(report, {
            valid: false,
            mailbox_verified: 'unknown',
            status: 'unknown',
            smtp_response: rawSmtp || preview(text),
            verdict_summary: `${email} — could not verify (${why}): ${preview(rawSmtp || text)}`,
        });
    }

    if (mailbox) {
        return finish(report, {
            valid: false,
            mailbox_verified: 'no',
            status: 'invalid',
            smtp_response: rawSmtp || preview(text),
            verdict_summary: `${email} seems not to be valid`,
        });
    }

    if (isConfirmedCatchAll(report, lower)) {
        return finish(report, {
            valid: false,
            mailbox_verified: 'catch_all',
            status: 'risky',
            smtp_response: rawSmtp || '250 OK',
            misc: { ...(report.misc || {}), catch_all: true },
            verdict_summary: `${email} — domain accepts all recipients (catch-all / risky)`,
        });
    }

    const reacherSmtp = report.reacher_raw?.smtp;
    const reacherProves = !!(
        reacherSmtp
        && reacherSmtp.can_connect_smtp === true
        && reacherSmtp.is_deliverable === true
        && reacherSmtp.is_catch_all !== true
    );
    if ((ACCEPT_RE.test(lower) || reacherProves) && !policy && !mailbox) {
        const response = rawSmtp || (reacherProves ? '250 OK' : '250 OK');
        return finish(report, {
            valid: true,
            mailbox_verified: 'yes',
            status: 'valid',
            smtp_response: ACCEPT_RE.test(response) ? response : response,
            verdict_summary: `${email} seems to be valid`,
        });
    }

    if (report.valid === true || String(report.mailbox_verified || '').toLowerCase() === 'yes') {
        return finish(report, {
            valid: false,
            mailbox_verified: 'unknown',
            status: 'unknown',
            smtp_response: rawSmtp,
            verdict_summary: rawSmtp
                ? `${email} — could not verify: ${preview(rawSmtp)}`
                : `${email} — could not verify (no RCPT TO acceptance)`,
        });
    }

    return report;
}

function mapStatus(report) {
    if (!report || typeof report !== 'object') return 'unknown';
    const status = String(report.status || '').toLowerCase();
    if (status === 'pending') return 'pending';
    const mailbox = String(report.mailbox_verified || '').toLowerCase();
    if (mailbox === 'no') return 'invalid';
    if (status === 'risky' || mailbox === 'catch_all' || report.misc?.catch_all) return 'risky';
    if (report.valid === true && mailbox === 'yes' && status !== 'unknown' && status !== 'risky') return 'valid';
    if (report.misc?.disposable) return 'disposable';
    if (status === 'unknown' || mailbox === 'unknown') return 'unknown';
    if (mailbox === 'no_smtp') return report.domain_valid === false ? 'invalid' : 'unknown';
    if (status === 'invalid' || mailbox === 'no' || report.domain_valid === false) return 'invalid';
    return status || 'invalid';
}

function normalizeStoredRow(row) {
    if (!row || typeof row !== 'object') return row;
    const report = applySmtpResponseRules({
        email: row.email,
        valid: row.valid,
        domain_valid: row.domain_valid,
        mailbox_verified: row.mailbox_verified,
        smtp_response: row.smtp_response,
        status: row.status,
        misc: row.misc,
        checks: row.checks,
        reacher_raw: row.reacher_raw,
    });
    return {
        ...row,
        valid: report.valid,
        mailbox_verified: report.mailbox_verified,
        smtp_response: report.smtp_response || row.smtp_response || '',
        status: mapStatus(report),
        verdict_summary: report.verdict_summary || row.verdict_summary,
        misc: report.misc || row.misc,
    };
}

module.exports = {
    applySmtpResponseRules,
    mapStatus,
    normalizeStoredRow,
    MAILBOX_RE,
    POLICY_RE,
};
