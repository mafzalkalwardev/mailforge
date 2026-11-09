function isValidStatus(status, details) {
    const s = String(status || '').toLowerCase();
    if (['invalid', 'unknown', 'no_smtp', 'risky', 'catch_all', 'disposable', 'error', 'fail'].includes(s)) {
        return false;
    }
    if (s === 'valid' || s === 'ok') return true;
    const report = details?.report;
    if (!report || report.catch_all) return false;
    const mailbox = String(report.mailbox_verified || '').toLowerCase();
    if (mailbox === 'unknown' || mailbox === 'catch_all' || mailbox === 'no' || mailbox === 'no_smtp') return false;
    return report.valid === true && mailbox === 'yes';
}

function isUnknownStatus(status) {
    const s = String(status || '').toLowerCase();
    return s === 'unknown' || s === 'no_smtp';
}

function classifyHistoryRecord(record) {
    if (isValidStatus(record.status, record.details)) return 'valid';
    if (isUnknownStatus(record.status)) return 'unknown';
    return 'invalid';
}

function statusBadgeClass(status, details) {
    if (isValidStatus(status, details)) return 'bg-success';
    const s = String(status || '').toLowerCase();
    if (s === 'fail' || s === 'error' || s === 'invalid') return 'bg-danger';
    if (s === 'disposable' || s === 'catch_all' || s === 'risky') return 'bg-warning text-dark';
    if (isUnknownStatus(s)) return 'bg-secondary';
    return 'bg-danger';
}

function statusLabel(status, details) {
    if (isValidStatus(status, details)) return 'VALID';
    return String(status || 'unknown').toUpperCase();
}

module.exports = {
    isValidStatus,
    isUnknownStatus,
    classifyHistoryRecord,
    statusBadgeClass,
    statusLabel,
};
