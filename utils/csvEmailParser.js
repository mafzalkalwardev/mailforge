const fs = require('fs');
const xlsx = require('xlsx');

const EMAIL_RE = /[^\s,;"<>]+@[^\s,;"<>]+\.[^\s,;"<>]+/gi;

function stripBom(text) {
    if (text.charCodeAt(0) === 0xfeff) {
        return text.slice(1);
    }
    return text;
}

function detectDelimiter(line) {
    const commas = (line.match(/,/g) || []).length;
    const semis = (line.match(/;/g) || []).length;
    const tabs = (line.match(/\t/g) || []).length;
    if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
    if (semis > commas) return ';';
    return ',';
}

function extractEmailFromCell(cell) {
    if (cell == null || cell === '') return null;
    const str = String(cell).trim();
    const matches = str.match(EMAIL_RE);
    return matches ? matches[0].toLowerCase() : null;
}

function parseCsvLine(line, delimiter) {
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
            cells.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells.map(c => c.trim());
}

function looksLikeHeader(cells) {
    return cells.some(c => /e[\-\s]?mail/i.test(String(c).trim()));
}

function parseCsvFile(filePath) {
    const raw = stripBom(fs.readFileSync(filePath, 'utf8'));
    const lines = raw.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) {
        return { rows: [], emails: [], headers: null };
    }

    const delimiter = detectDelimiter(lines[0]);
    const parsedRows = lines.map(line => parseCsvLine(line, delimiter));

    let headers = null;
    let startIndex = 0;
    if (looksLikeHeader(parsedRows[0])) {
        headers = parsedRows[0].map(h => String(h).trim());
        startIndex = 1;
    }

    const rows = [];
    const emails = [];
    const seen = new Set();

    parsedRows.slice(startIndex).forEach((cells, rowIndex) => {
        let email = null;
        let emailCol = -1;
        for (let col = 0; col < cells.length; col++) {
            const found = extractEmailFromCell(cells[col]);
            if (found) {
                email = found;
                emailCol = col;
                break;
            }
        }
        if (!email) return;

        rows.push({
            rowIndex,
            email,
            emailCol,
            originalRow: cells,
        });
        if (!seen.has(email)) {
            seen.add(email);
            emails.push(email);
        }
    });

    return { rows, emails, headers, delimiter };
}

function parseXlsxFile(filePath) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    let headers = null;
    let startIndex = 0;
    if (data.length && looksLikeHeader(data[0])) {
        headers = data[0].map(h => String(h).trim());
        startIndex = 1;
    }

    const rows = [];
    const emails = [];
    const seen = new Set();

    data.slice(startIndex).forEach((cells, rowIndex) => {
        if (!cells || cells.length === 0) return;
        const rowCells = cells.map(c => (c == null ? '' : String(c)));

        let email = null;
        let emailCol = -1;
        for (let col = 0; col < rowCells.length; col++) {
            const found = extractEmailFromCell(rowCells[col]);
            if (found) {
                email = found;
                emailCol = col;
                break;
            }
        }
        if (!email) return;

        rows.push({
            rowIndex,
            email,
            emailCol,
            originalRow: rowCells,
        });
        if (!seen.has(email)) {
            seen.add(email);
            emails.push(email);
        }
    });

    return { rows, emails, headers };
}

function parseBulkFile(filePath, originalname) {
    if (originalname.endsWith('.xlsx')) {
        return parseXlsxFile(filePath);
    }
    return parseCsvFile(filePath);
}

module.exports = {
    parseBulkFile,
    extractEmailFromCell,
    EMAIL_RE,
};
