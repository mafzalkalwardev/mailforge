const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildRecentResults } = require('../utils/bulkVerifyWorker');

describe('bulkVerifyWorker recent results', () => {
    it('does not show claimed but unfinished emails as failed results', () => {
        const job = {
            nextEmailIndex: 4,
            emails: [
                'done1@example.com',
                'claimed1@example.com',
                'done2@example.com',
                'claimed2@example.com',
            ],
            resultsByEmail: {
                'done1@example.com': {
                    domain_valid: true,
                    mailbox_verified: 'yes',
                    valid: true,
                    smtp_response: '250 OK',
                    status: 'valid',
                },
                'done2@example.com': {
                    domain_valid: true,
                    mailbox_verified: 'no',
                    valid: false,
                    smtp_response: '550 user unknown',
                    status: 'invalid',
                },
            },
        };

        const recent = buildRecentResults(job);

        assert.deepEqual(
            recent.map(r => r.email),
            ['done2@example.com', 'done1@example.com']
        );
        assert.equal(recent.some(r => r.email.startsWith('claimed')), false);
    });
});
