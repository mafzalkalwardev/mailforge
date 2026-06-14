const { applySmtpResponseRules } = require('../utils/smtpResponseRules');
const test = require('node:test');
const assert = require('node:assert/strict');

test('550 rejection marks email invalid', () => {
    const report = applySmtpResponseRules({
        email: 'test@example.com',
        valid: true,
        smtp_response: '550 5.1.1 User unknown',
    });
    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'no');
});

test('IP block marks unknown not valid', () => {
    const report = applySmtpResponseRules({
        email: 'test@example.com',
        valid: true,
        smtp_response: '550 5.7.1 Service unavailable - client host blocked',
    });
    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'unknown');
});

test('250 OK keeps valid', () => {
    const report = applySmtpResponseRules({
        email: 'good@example.com',
        valid: false,
        smtp_response: '250 2.1.5 OK',
    });
    assert.equal(report.valid, true);
    assert.equal(report.mailbox_verified, 'yes');
});

test('empty smtp response passes through', () => {
    const report = applySmtpResponseRules({ email: 'a@b.com', valid: true });
    assert.equal(report.valid, true);
});
