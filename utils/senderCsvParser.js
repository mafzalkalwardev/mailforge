const fs = require('fs');
const xlsx = require('xlsx');

function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function findColumn(headers, names) {
    for (let i = 0; i < headers.length; i++) {
        const h = normalizeHeader(headers[i]);
        if (names.some(n => h === n || h.includes(n))) return i;
    }
    return -1;
}

function parseCsvLine(line, delimiter = ',') {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === delimiter && !inQuotes) {
            cells.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current.trim());
    return cells;
}

function parseSenderFile(filePath, originalname) {
    const ext = originalname.toLowerCase();
    let rows = [];
    let headers = [];

    if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
        const wb = xlsx.readFile(filePath);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (!data.length) return [];
        headers = data[0].map(c => String(c).trim());
        rows = data.slice(1);
    } else {
        const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
        const lines = raw.split(/\r?\n/).filter(l => l.trim());
        if (!lines.length) return [];
        const delimiter = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
        headers = parseCsvLine(lines[0], delimiter);
        rows = lines.slice(1).map(line => parseCsvLine(line, delimiter));
    }

    const emailCol = findColumn(headers, ['email', 'mail', 'senderemail']);
    const passCol = findColumn(headers, ['apppassword', 'password', 'pass', 'apppass']);
    const nameCol = findColumn(headers, ['name', 'displayname', 'sendername']);

    if (emailCol === -1 || passCol === -1) {
        throw new Error('CSV must have Email and AppPassword (or Password) columns');
    }

    const senders = [];
    rows.forEach((cells, idx) => {
        const email = String(cells[emailCol] || '').trim().toLowerCase();
        const appPassword = String(cells[passCol] || '').trim();
        const displayName = nameCol >= 0 ? String(cells[nameCol] || '').trim() : '';
        if (!email || !appPassword) return;
        if (!email.includes('@')) {
            senders.push({ row: idx + 2, email, error: 'Invalid email' });
            return;
        }
        senders.push({ email, appPassword, displayName: displayName || email.split('@')[0] });
    });

    return senders;
}

module.exports = { parseSenderFile };
