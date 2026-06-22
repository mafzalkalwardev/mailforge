const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    analyzeListHygiene,
    dedupeRows,
    filterRowsForExport,
    rowsToCsv,
} = require('../utils/bulkJobUtils');

describe('bulkJobUtils', () => {
    const sampleRows = [
        { email: 'a@test.com', valid: true, mailbox_verified: 'valid', status: 'ok' },
        { email: 'a@test.com', valid: false, mailbox_verified: 'invalid', status: 'invalid' },
        { email: 'info@corp.com', valid: false, mailbox_verified: 'invalid', status: 'disposable' },
        { email: 'b@test.com', valid: false, mailbox_verified: 'unknown', status: 'unknown' },
    ];

    it('analyzeListHygiene counts duplicates and role-like addresses', () => {
        const h = analyzeListHygiene(sampleRows, new Date().toISOString());
        assert.equal(h.total, 4);
        assert.equal(h.duplicates, 1);
        assert.equal(h.valid, 1);
        assert.equal(h.disposable, 1);
        assert.equal(h.roleLike, 1);
        assert.ok(h.score >= 0 && h.score <= 100);
    });

    it('dedupeRows keeps first by default', () => {
        const out = dedupeRows(sampleRows);
        assert.equal(out.length, 3);
        assert.equal(out[0].valid, true);
    });

    it('dedupeRows keep valid prefers valid row', () => {
        const out = dedupeRows(sampleRows, 'valid');
        const aRow = out.find(r => r.email === 'a@test.com');
        assert.equal(aRow.valid, true);
    });

    it('filterRowsForExport valid_only and valid_unknown', () => {
        assert.equal(filterRowsForExport(sampleRows, 'valid').length, 1);
        assert.equal(filterRowsForExport(sampleRows, 'valid_unknown').length, 2);
        assert.equal(filterRowsForExport(sampleRows, 'all').length, 4);
    });

    it('rowsToCsv includes verification columns', () => {
        const csv = rowsToCsv(['email'], [{ email: 'x@y.com', valid: true, mailbox_verified: 'valid', smtp_response: '250 OK', status: 'ok' }]);
        assert.match(csv, /email/);
        assert.match(csv, /yes/);
        assert.match(csv, /250 OK/);
    });

    it('rowsToCsv preserves original columns before appended verification columns', () => {
        const headers = ['MC Number', 'Legal Name', 'States', 'Address', 'Phone', 'Email'];
        const csv = rowsToCsv(headers, [{
            email: 'arborists22@gmail.com',
            originalRow: ['MC-1778293', 'C&D PRIME LOGISTICS LLC', 'AL', '275 FORESTDALE DR OXFORD, AL 36203', '(256) 294-6377', 'ARBORISTS22@GMAIL.COM'],
            valid: true,
            domain_valid: true,
            mailbox_verified: 'yes',
            smtp_response: '250 OK',
            status: 'valid',
        }]);

        const [headerLine, rowLine] = csv.split('\r\n');
        assert.ok(headerLine.startsWith('"MC Number","Legal Name","States","Address","Phone","Email"'));
        assert.match(headerLine, /"verification_valid","verification_domain_valid","verification_mailbox_verified","verification_status","verification_smtp_response"$/);
        assert.ok(rowLine.startsWith('"MC-1778293","C&D PRIME LOGISTICS LLC","AL"'));
        assert.match(rowLine, /"yes","yes","yes","valid","250 OK"$/);
    });

    it('rowsToCsv keeps original cells when rows have more columns than headers', () => {
        const csv = rowsToCsv(['Name'], [{
            email: 'x@y.com',
            originalRow: ['Jane', 'Dispatch', 'x@y.com'],
            valid: false,
            domain_valid: true,
            mailbox_verified: 'unknown',
            status: 'unknown',
        }]);

        const [headerLine, rowLine] = csv.split('\r\n');
        assert.ok(headerLine.startsWith('"Name","col_2","col_3"'));
        assert.ok(rowLine.startsWith('"Jane","Dispatch","x@y.com"'));
    });
});
