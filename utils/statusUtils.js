const { applySmtpResponseRules, mapStatus } = require('./smtpResponseRules');

function normalizedReport(status, details) {
    if (!details?.report) return null;
    return applySmtpResponseRules({ ...details.report, status: details.report.status || status });
}

function isValidStatus(status, details) {
    const report = normalizedReport(status, details);
    if (report) return mapStatus(report) === 'valid' && report.valid === true && report.mailbox_verified === 'yes';
    const s = String(status || '').toLowerCase();
    return s === 'valid' || s === 'ok';
}

function isUnknownStatus(status) {
    const s = String(status || '').toLowerCase();
    return s === 'unknown' || s === 'no_smtp';
}

function classifyHistoryRecord(record) {
    const report = normalizedReport(record.status, record.details);
    if (report) {
        const status = mapStatus(report);
        if (status === 'valid') return 'valid';
        if (status === 'unknown' || status === 'no_smtp') return 'unknown';
        return 'invalid';
    }
    if (isValidStatus(record.status, record.details)) return 'valid';
    if (isUnknownStatus(record.status)) return 'unknown';
    return 'invalid';
}

function displayStatus(status, details) {
    const report = normalizedReport(status, details);
    if (report) return mapStatus(report);
    const stored = String(status || 'unknown').toLowerCase();
    return stored === 'ok' ? 'valid' : stored;
}

function statusBadgeClass(status, details) {
    const s = displayStatus(status, details);
    if (s === 'valid' || s === 'ok') return 'bg-success';
    if (s === 'fail' || s === 'error' || s === 'invalid') return 'bg-danger';
    if (s === 'disposable' || s === 'catch_all' || s === 'risky') return 'bg-warning text-dark';
    if (s === 'unknown' || s === 'no_smtp') return 'bg-secondary';
    return 'bg-danger';
}

function statusLabel(status, details) {
    return displayStatus(status, details).toUpperCase();
}

module.exports = {
    isValidStatus,
    isUnknownStatus,
    classifyHistoryRecord,
    statusBadgeClass,
    statusLabel,
};
