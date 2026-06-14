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
});
