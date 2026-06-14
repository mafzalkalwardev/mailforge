const ROLE_PREFIXES = ['admin', 'info', 'support', 'sales', 'contact', 'hello', 'noreply', 'no-reply'];

function analyzeListHygiene(rows, completedAt) {
    const emails = (rows || []).map(r => String(r.email || '').toLowerCase().trim()).filter(Boolean);
    const unique = new Set(emails);
    const duplicates = emails.length - unique.size;

    let valid = 0;
    let invalid = 0;
    let unknown = 0;
    let disposable = 0;
    let roleLike = 0;

    for (const row of rows || []) {
        const email = String(row.email || '').toLowerCase();
        const local = email.split('@')[0] || '';
        if (row.valid) valid += 1;
        else if (['unknown', 'no_smtp'].includes(String(row.mailbox_verified || row.status || '').toLowerCase())) unknown += 1;
        else invalid += 1;
        if (String(row.status || '').toLowerCase() === 'disposable') disposable += 1;
        if (ROLE_PREFIXES.some(p => local === p || local.startsWith(p + '.'))) roleLike += 1;
    }

    const ageDays = completedAt
        ? Math.floor((Date.now() - new Date(completedAt).getTime()) / (24 * 60 * 60 * 1000))
        : 0;

    return {
        total: emails.length,
        unique: unique.size,
        duplicates,
        valid,
        invalid,
        unknown,
        disposable,
        roleLike,
        ageDays,
        stale: ageDays > 30,
        score: emails.length
            ? Math.round(((valid / emails.length) * 0.6 + (1 - duplicates / Math.max(emails.length, 1)) * 0.2 + (ageDays <= 30 ? 0.2 : 0)) * 100)
            : 0,
    };
}

function dedupeRows(rows, keep = 'first') {
    const seen = new Map();
    const out = [];
    for (const row of rows || []) {
        const email = String(row.email || '').toLowerCase().trim();
        if (!email) continue;
        if (!seen.has(email)) {
            seen.set(email, row);
            out.push(row);
        } else if (keep === 'valid') {
            const prev = seen.get(email);
            if (row.valid && !prev.valid) {
                const idx = out.findIndex(r => String(r.email).toLowerCase() === email);
                if (idx >= 0) out[idx] = row;
                seen.set(email, row);
            }
        }
    }
    return out;
}

function filterRowsForExport(rows, filter = 'all') {
    const f = String(filter).toLowerCase();
    if (f === 'valid') return (rows || []).filter(r => r.valid);
    if (f === 'valid_unknown') {
        return (rows || []).filter(r => {
            if (r.valid) return true;
            const mv = String(r.mailbox_verified || '').toLowerCase();
            return mv === 'unknown' || mv === 'no_smtp';
        });
    }
    return rows || [];
}

function rowsToCsv(headers, rows) {
    const hdrs = Array.isArray(headers) && headers.length
        ? [...headers, 'valid', 'mailbox_verified', 'smtp_response', 'status']
        : ['email', 'valid', 'mailbox_verified', 'smtp_response', 'status'];

    const lines = [hdrs.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',')];
    for (const row of rows) {
        const base = Array.isArray(row.originalRow) && headers?.length
            ? headers.map((_, i) => row.originalRow[i] ?? '')
            : [row.email || ''];
        const extra = [
            row.valid ? 'yes' : 'no',
            row.mailbox_verified || '',
            (row.smtp_response || '').replace(/\r?\n/g, ' '),
            row.status || '',
        ];
        const cells = [...base, ...extra].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`);
        lines.push(cells.join(','));
    }
    return lines.join('\r\n');
}

module.exports = {
    analyzeListHygiene,
    dedupeRows,
    filterRowsForExport,
    rowsToCsv,
    ROLE_PREFIXES,
};
