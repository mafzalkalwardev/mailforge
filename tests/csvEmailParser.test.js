const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseBulkFile } = require('../utils/csvEmailParser');

async function parseFixture(t, csv) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailforge-csv-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'contacts.csv');
    fs.writeFileSync(file, csv);
    return parseBulkFile(file, 'contacts.csv');
}

describe('csvEmailParser', () => {
    const fixtures = [
        {
            name: 'comma-separated header and later email column',
            csv: 'Name,Email\nAlice,ALICE@example.com\n',
            delimiter: ',', headers: ['Name', 'Email'], cells: ['Alice', 'ALICE@example.com'],
        },
        {
            name: 'semicolon-separated fields',
            csv: 'Name;Email\r\nAlice;ALICE@example.com\r\n',
            delimiter: ';', headers: ['Name', 'Email'], cells: ['Alice', 'ALICE@example.com'],
        },
        {
            name: 'tab-separated fields with a BOM',
            csv: '\ufeffName\tEmail\nAlice\tALICE@example.com\n',
            delimiter: '\t', headers: ['Name', 'Email'], cells: ['Alice', 'ALICE@example.com'],
        },
        {
            name: 'quoted data containing a comma',
            csv: 'Name,Email\n"Alice, Smith",ALICE@example.com\n',
            delimiter: ',', headers: ['Name', 'Email'], cells: ['Alice, Smith', 'ALICE@example.com'],
        },
        {
            name: 'commas in a quoted header do not override semicolon separators',
            csv: '"Name, company, team";Email\n"Alice, Acme, Sales";ALICE@example.com\n',
            delimiter: ';', headers: ['Name, company, team', 'Email'], cells: ['Alice, Acme, Sales', 'ALICE@example.com'],
        },
        {
            name: 'quoted tabs do not override semicolon separators',
            csv: '"Name\tcompany\tteam";Email\nAlice;ALICE@example.com\n',
            delimiter: ';', headers: ['Name\tcompany\tteam', 'Email'], cells: ['Alice', 'ALICE@example.com'],
        },
        {
            name: 'escaped quotes keep header punctuation inside its field',
            csv: '"Name ""company, team, region""";Email\nAlice;ALICE@example.com\n',
            delimiter: ';', headers: ['Name "company, team, region"', 'Email'], cells: ['Alice', 'ALICE@example.com'],
        },
        {
            name: 'quoted semicolons do not override comma separators',
            csv: '"Name; company; team",Email\nAlice,ALICE@example.com\n',
            delimiter: ',', headers: ['Name; company; team', 'Email'], cells: ['Alice', 'ALICE@example.com'],
        },
    ];

    for (const fixture of fixtures) {
        it(fixture.name, async t => {
            const parsed = await parseFixture(t, fixture.csv);
            assert.equal(parsed.delimiter, fixture.delimiter);
            assert.deepEqual(parsed.headers, fixture.headers);
            assert.deepEqual(parsed.emails, ['alice@example.com']);
            assert.deepEqual(parsed.rows, [{
                rowIndex: 0, email: 'alice@example.com', emailCol: 1, originalRow: fixture.cells,
            }]);
        });
    }

    it('deduplicates verification addresses while retaining original rows and indexes', async t => {
        const parsed = await parseFixture(t, 'Name,Email\nAlice,ALICE@example.com\nMissing,\nAgain,alice@example.com\n');
        assert.deepEqual(parsed.emails, ['alice@example.com']);
        assert.deepEqual(parsed.rows.map(row => row.rowIndex), [0, 2]);
        assert.deepEqual(parsed.rows.map(row => row.originalRow[0]), ['Alice', 'Again']);
    });
});
