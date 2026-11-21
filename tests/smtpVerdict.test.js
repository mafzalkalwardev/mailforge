const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { applySmtpResponseRules, PORT25_REASON } = require('../utils/smtpResponseRules');
const { mapStatus } = require('../utils/verificationEngine');
const { mapReacherToReport } = require('../utils/reacherClient');
const { probeBanner, buildReport } = require('../utils/port25Check');

function finalize(report) {
    const normalized = applySmtpResponseRules(report);
    return { ...normalized, status: mapStatus(normalized) };
}

test('connection timeout gives unknown, not valid', () => {
    const report = finalize({
        email: 'test.nonexistent.xyz123@web.de',
        valid: true,
        mailbox_verified: 'yes',
        domain_valid: true,
        smtp_response: 'dial tcp 212.227.17.12:25: i/o timeout',
        checks: [{
            step: 'smtp',
            passed: true,
            message: 'Dialog with mx01.web.de succeeded',
            detail: '250 OK',
        }],
    });

    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'unknown');
    assert.equal(report.status, 'unknown');
    assert.match(report.verdict_summary, /SMTP port 25 unreachable from this server/);
    assert.match(report.smtp_response, /i\/o timeout/);
    const smtp = (report.checks || []).find(check => check.step === 'smtp');
    assert.equal(smtp.passed, false);
    assert.equal(smtp.detail.includes('250 OK'), false);
});

test('550 gives invalid', () => {
    const report = finalize({
        email: 'missing@example.com',
        valid: true,
        mailbox_verified: 'yes',
        domain_valid: true,
        smtp_response: '550 5.1.1 User unknown',
    });
    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'no');
    assert.equal(report.status, 'invalid');
});

test('250 gives valid', () => {
    const report = finalize({
        email: 'real.user@example.com',
        valid: false,
        mailbox_verified: 'no',
        domain_valid: true,
        smtp_response: '250 2.1.5 OK',
    });
    assert.equal(report.valid, true);
    assert.equal(report.mailbox_verified, 'yes');
    assert.equal(report.status, 'valid');
});

test('catch-all gives risky', () => {
    const report = finalize({
        email: 'anyone@lists.example',
        valid: true,
        mailbox_verified: 'yes',
        domain_valid: true,
        catch_all: true,
        smtp_response: '250 OK',
    });
    assert.equal(report.valid, false);
    assert.equal(report.mailbox_verified, 'catch_all');
    assert.equal(report.status, 'risky');
    assert.match(report.verdict_summary, /risky\/catch-all/);
});

test('greylisting gives unknown', () => {
    const report = finalize({
        email: 'person@example.com',
        valid: true,
        mailbox_verified: 'yes',
        smtp_response: '451 4.7.1 Greylisted, try again later',
    });
    assert.equal(report.valid, false);
    assert.equal(report.status, 'unknown');
});

test('reacher catch-all and unreachable are not valid', () => {
    const catchAll = finalize(mapReacherToReport({
        input: 'a@accept.example',
        is_reachable: 'risky',
        syntax: { is_valid_syntax: true },
        mx: { accepts_mail: true, records: ['mx.accept.example'] },
        smtp: { can_connect_smtp: true, is_deliverable: true, is_catch_all: true },
        misc: {},
    }, 'a@accept.example'));
    assert.equal(catchAll.status, 'risky');
    assert.equal(catchAll.valid, false);

    const blocked = finalize(mapReacherToReport({
        input: 'a@web.de',
        is_reachable: 'unknown',
        syntax: { is_valid_syntax: true },
        mx: { accepts_mail: true, records: ['mx-ha.web.de'] },
        smtp: { can_connect_smtp: false, is_deliverable: false, is_catch_all: false },
        misc: {},
    }, 'a@web.de'));
    assert.equal(blocked.valid, false);
    assert.equal(blocked.status, 'unknown');
    assert.match(blocked.smtp_response, new RegExp(PORT25_REASON));
});

test('port 25 banner probe sees a local SMTP greeting and a stall', async () => {
    const ready = await listen(socket => {
        socket.end('220 ready.example ESMTP\r\n');
    });
    const open = await probeBanner({ host: '127.0.0.1', port: ready.port, timeoutMs: 1000 });
    assert.equal(open.ok, true);
    ready.close();

    const stalled = await listen(() => {});
    const closed = await probeBanner({ host: '127.0.0.1', port: stalled.port, timeoutMs: 200 });
    assert.equal(closed.ok, false);
    assert.match(closed.detail, /SMTP port 25 unreachable/);
    stalled.close();

    const summary = buildReport(
        { ok: false, detail: PORT25_REASON },
        { ok: true, detail: '220 proxy' },
        'socks5://127.0.0.1:1080'
    );
    assert.equal(summary.reachable, true);
    assert.equal(summary.direct_reachable, false);
    assert.equal(summary.via, 'proxy');
});

test('port 25 probe can use a SOCKS5 proxy', async () => {
    const smtp = await listen(socket => {
        socket.end('220 via-proxy ESMTP\r\n');
    });
    const proxy = await listenSocks(() => smtp.port);
    const result = await probeBanner({
        host: '127.0.0.1',
        port: smtp.port,
        proxy: `socks5://127.0.0.1:${proxy.port}`,
        timeoutMs: 1000,
    });
    assert.equal(result.ok, true);
    assert.match(result.detail, /via-proxy/);
    smtp.close();
    proxy.close();
});

function listen(onConnection) {
    return new Promise((resolve, reject) => {
        const server = net.createServer(onConnection);
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                close: () => server.close(),
            });
        });
    });
}

function listenSocks() {
    return new Promise((resolve, reject) => {
        const server = net.createServer(client => {
            client.once('data', () => {
                client.write(Buffer.from([0x05, 0x00]));
                client.once('data', request => {
                    const atyp = request[3];
                    let offset = 4;
                    if (atyp === 0x01) offset += 4;
                    else if (atyp === 0x03) offset += 1 + request[4];
                    else if (atyp === 0x04) offset += 16;
                    const port = request.readUInt16BE(offset);
                    const dest = net.connect(port, '127.0.0.1');
                    dest.pause();
                    dest.once('connect', () => {
                        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                        client.pipe(dest);
                        dest.pipe(client);
                        dest.resume();
                    });
                    dest.on('error', () => client.destroy());
                });
            });
        });
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                close: () => server.close(),
            });
        });
    });
}
