function fileBaseName(fileName) {
    if (!fileName) return 'email_verification';
    return String(fileName).replace(/\.[^.]+$/, '') || 'email_verification';
}

function escapeCsvCell(value) {
    return `"${String(value ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`;
}

function originalHeaders(headers, rows) {
    const given = Array.isArray(headers) ? headers : [];
    const maxCols = Math.max(given.length, ...rows.map(r => (r.originalRow || []).length), 0);
    if (!maxCols) return ['email'];
    return Array.from({ length: maxCols }, (_, i) => String(given[i] || '').trim() || `col_${i + 1}`);
}

function buildVerificationCsv(rows, validOnly, headers = []) {
    const filtered = (validOnly ? rows.filter(r => r.valid) : rows).filter(r => r.status !== 'pending');
    if (!filtered.length) return '';

    const origHeaders = originalHeaders(headers, filtered);
    const hasOriginalRows = filtered.some(r => (r.originalRow || []).length);
    const header = [
        ...origHeaders,
        'verification_valid',
        'verification_domain_valid',
        'verification_mailbox_verified',
        'verification_status',
        'verification_smtp_response',
    ].map(escapeCsvCell).join(',');
    const lines = [header];

    filtered.forEach(r => {
        const orig = r.originalRow || [];
        const base = hasOriginalRows ? origHeaders.map((_, i) => orig[i] || '') : [r.email || ''];
        lines.push([
            ...base,
            r.valid ? 'yes' : 'no',
            r.domain_valid ? 'yes' : 'no',
            r.mailbox_verified || '',
            r.status || '',
            r.smtp_response || '',
        ].map(escapeCsvCell).join(','));
    });

    return lines.join('\r\n');
}

function downloadCsv(content, name) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

function exportJobCsv(job, validOnly) {
    const rows = job.rows || [];
    const csv = buildVerificationCsv(rows, validOnly, job.headers || []);
    if (!csv) return false;

    const base = fileBaseName(job.fileName);
    const suffix = validOnly ? '_valid' : '_all';
    downloadCsv(csv, `${base}${suffix}.csv`);
    return true;
}

window.CsvExport = { fileBaseName, buildVerificationCsv, downloadCsv, exportJobCsv };
