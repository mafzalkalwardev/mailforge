const { applySmtpResponseRules, mapStatus, normalizeStoredRow } = require('../utils/smtpResponseRules');
const test = require('node:test');
const assert = require('node:assert/strict');

test('connection timeout is unknown, even if a check claims 250 OK', () => {
    const report = applySmtpResponseRules({
        email: 'test.nonexistent.xyz123@web.de',
        valid: true,
        mailbox_verified: 'yes',
        smtp_response: 'dial tcp 212.227.17.190:25: i/o timeout',
        checks: [{ step: 'smtp', passed: true, message: 'Dialog with mx-ha02.web.de succeeded', detail: '250 OK' }],
    });
    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'unknown');
    assert.equal(report.status, 'unknown');
    assert.equal(mapStatus(report), 'unknown');
    assert.match(report.smtp_response, /SMTP port 25 unreachable from this server/);
    assert.equal(report.checks[0].passed, false);
    assert.match(report.checks[0].detail, /i\/o timeout|SMTP port 25 unreachable/);
});

test('verification proxy offline is unknown and not valid', () => {
    const report = applySmtpResponseRules({
        email: 'person@gmail.com',
        valid: true,
        mailbox_verified: 'yes',
        smtp_response: 'verification proxy offline: dial tcp 127.0.0.1:1080: connect: connection refused',
    });
    assert.equal(report.valid, false);
    assert.equal(report.status, 'unknown');
    assert.match(report.verdict_summary, /verification proxy offline/);
    assert.match(report.smtp_response, /verification proxy offline/);
});

test('550 5.1.1 user unknown is invalid', () => {
    const report = applySmtpResponseRules({
        email: 'fake.user@gmail.com',
        valid: true,
        smtp_response: '550 5.1.1 The email account that you tried to reach does not exist',
    });
    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'no');
    assert.equal(report.status, 'invalid');
    assert.equal(mapStatus(report), 'invalid');
});

test('550 mailbox unavailable is invalid', () => {
    const report = applySmtpResponseRules({
        email: 'gone@example.com',
        valid: false,
        smtp_response: '550 5.1.1 mailbox unavailable',
    });
    assert.equal(report.status, 'invalid');
    assert.equal(report.mailbox_verified, 'no');
});

test('250 acceptance is valid', () => {
    const report = applySmtpResponseRules({
        email: 'good@example.com',
        valid: false,
        smtp_response: '250 2.1.5 OK',
    });
    assert.equal(report.valid, true);
    assert.equal(report.mailbox_verified, 'yes');
    assert.equal(report.status, 'valid');
    assert.equal(mapStatus(report), 'valid');
});

test('554 PTR / No SMTP service is unknown, not invalid', () => {
    const report = applySmtpResponseRules({
        email: 'postmaster@gmx.net',
        valid: false,
        mailbox_verified: 'no',
        status: 'invalid',
        smtp_response: '554-No SMTP service 554-Invalid DNS PTR resource record 554 see https://www.spamhaus.org/query/ip/203.0.113.10',
    });
    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'unknown');
    assert.equal(report.status, 'unknown');
    assert.equal(mapStatus(report), 'unknown');
    assert.match(report.verdict_summary, /policy rejection, not a mailbox result/i);
    assert.doesNotMatch(report.verdict_summary, /seems not to be valid/);
});

test('client host rejected and access denied stay unknown', () => {
    const report = applySmtpResponseRules({
        email: 'postmaster@web.de',
        valid: false,
        mailbox_verified: 'no',
        status: 'invalid',
        smtp_response: '550 5.7.1 Client host rejected: access denied',
    });
    assert.equal(report.valid, false);
    assert.equal(report.status, 'unknown');
    assert.equal(report.mailbox_verified, 'unknown');
});

test('421 greylist is unknown', () => {
    const report = applySmtpResponseRules({
        email: 'user@example.com',
        valid: false,
        smtp_response: '421 4.7.0 Try again later, greylisted',
    });
    assert.equal(report.status, 'unknown');
    assert.equal(report.valid, false);
    assert.match(report.verdict_summary, /greylist|temporary/i);
});

test('IP block marks unknown not valid', () => {
    const report = applySmtpResponseRules({
        email: 'test@example.com',
        valid: true,
        smtp_response: '550 5.7.1 Service unavailable - client host blocked',
    });
    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'unknown');
    assert.equal(report.status, 'unknown');
});

test('mailbox 550 wins over a catch-all flag, including when the address contains catchall', () => {
    const report = applySmtpResponseRules({
        email: 'zzzcatchallprobe999@proton.me',
        valid: false,
        mailbox_verified: 'catch_all',
        status: 'risky',
        misc: { catch_all: true },
        smtp_response: '550 5.1.1 Address does not exist',
    });
    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'no');
    assert.equal(report.status, 'invalid');
    assert.equal(report.misc.catch_all, false);
    assert.equal(mapStatus(report), 'invalid');
});

test('550 that quotes a catchall-looking recipient is still invalid', () => {
    const report = applySmtpResponseRules({
        email: 'zzzcatchallprobe999@proton.me',
        valid: true,
        mailbox_verified: 'yes',
        smtp_response: '550 5.1.1 <zzzcatchallprobe999@proton.me>: Address does not exist',
    });
    assert.equal(report.status, 'invalid');
    assert.equal(report.mailbox_verified, 'no');
    assert.equal(report.valid, false);
    assert.equal(mapStatus(report), 'invalid');
});

test('catch-all is risky only when the target RCPT was accepted', () => {
    const report = applySmtpResponseRules({
        email: 'someone@catch.example',
        valid: true,
        mailbox_verified: 'yes',
        smtp_response: '250 2.1.5 OK',
        misc: { catch_all: true },
    });
    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'catch_all');
    assert.equal(report.status, 'risky');
    assert.equal(mapStatus(report), 'risky');
});

test('empty smtp response does not prove a mailbox is valid', () => {
    const report = applySmtpResponseRules({ email: 'a@b.com', valid: true, mailbox_verified: 'yes' });
    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'unknown');
    assert.equal(report.status, 'unknown');
});

test('stored policy 554 row exports as unknown', () => {
    const row = normalizeStoredRow({
        email: 'postmaster@gmx.net',
        valid: false,
        domain_valid: true,
        mailbox_verified: 'no',
        status: 'invalid',
        smtp_response: '554 No SMTP service Invalid DNS PTR resource record',
    });
    assert.equal(row.valid, false);
    assert.equal(row.status, 'unknown');
    assert.equal(row.mailbox_verified, 'unknown');
});
