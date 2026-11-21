const net = require('net');
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkSmtpPath } = require('../utils/smtpHealth');

function listen(handler) {
    return new Promise((resolve, reject) => {
        const server = net.createServer(handler);
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function startSocks() {
    return listen(socket => {
        socket.once('error', () => socket.destroy());
        let buf = Buffer.alloc(0);
        let stage = 'greeting';
        socket.on('data', chunk => {
            buf = Buffer.concat([buf, chunk]);
            if (stage === 'greeting') {
                if (buf.length < 2) return;
                const nmethods = buf[1];
                if (buf.length < 2 + nmethods) return;
                buf = buf.subarray(2 + nmethods);
                stage = 'request';
                socket.write(Buffer.from([0x05, 0x00]));
            }
            if (stage === 'request') {
                if (buf.length < 4) return;
                const atyp = buf[3];
                let offset = 4;
                let host = '';
                if (atyp === 0x01) {
                    if (buf.length < 10) return;
                    host = Array.from(buf.subarray(4, 8)).join('.');
                    offset = 8;
                } else if (atyp === 0x03) {
                    if (buf.length < 5) return;
                    const len = buf[4];
                    if (buf.length < 5 + len + 2) return;
                    host = buf.subarray(5, 5 + len).toString();
                    offset = 5 + len;
                } else {
                    socket.end();
                    return;
                }
                const port = buf.readUInt16BE(offset);
                const dest = net.connect(port, host);
                dest.on('error', () => {
                    socket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                    socket.end();
                });
                dest.on('connect', () => {
                    socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                    dest.pipe(socket);
                    socket.pipe(dest);
                });
                stage = 'tunnel';
            }
        });
    });
}

test('direct port 25 probe succeeds against an open local port', async () => {
    const server = await listen(socket => socket.end());
    const { port } = server.address();
    try {
        const result = await checkSmtpPath({
            proxy: '',
            probeHost: '127.0.0.1',
            port,
            timeoutMs: 1000,
            skipCache: true,
        });
        assert.equal(result.port25.ok, true);
        assert.equal(result.port25.via, 'direct');
        assert.equal(result.degraded, false);
        assert.equal(result.proxy.configured, false);
    } finally {
        server.close();
    }
});

test('closed SOCKS proxy is verification proxy offline', async () => {
    const server = await listen(() => {});
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    const result = await checkSmtpPath({
        proxy: `socks5://127.0.0.1:${port}`,
        probeHost: '127.0.0.1',
        port: 25,
        timeoutMs: 1000,
        skipCache: true,
    });
    assert.equal(result.proxy.configured, true);
    assert.equal(result.proxy.reachable, false);
    assert.equal(result.port25.ok, false);
    assert.equal(result.degraded, true);
    assert.match(result.proxy.reason, /verification proxy offline/);
    assert.match(result.port25.reason, /verification proxy offline/);
    assert.equal(result.proxy.endpoint, `127.0.0.1:${port}`);
});

test('open SOCKS proxy reports port 25 through the tunnel', async () => {
    const target = await listen(socket => socket.end());
    const proxy = await startSocks();
    try {
        const result = await checkSmtpPath({
            proxy: `socks5://${proxy.address().address}:${proxy.address().port}`,
            probeHost: '127.0.0.1',
            port: target.address().port,
            timeoutMs: 1500,
            skipCache: true,
        });
        assert.equal(result.proxy.reachable, true);
        assert.equal(result.port25.ok, true);
        assert.equal(result.port25.via, 'proxy');
        assert.equal(result.degraded, false);
    } finally {
        proxy.close();
        target.close();
    }
});

test('reachable proxy with a closed target is port 25 unreachable', async () => {
    const closed = await listen(() => {});
    const closedPort = closed.address().port;
    await new Promise(resolve => closed.close(resolve));
    const proxy = await startSocks();
    try {
        const result = await checkSmtpPath({
            proxy: `socks5://127.0.0.1:${proxy.address().port}`,
            probeHost: '127.0.0.1',
            port: closedPort,
            timeoutMs: 1500,
            skipCache: true,
        });
        assert.equal(result.proxy.reachable, true);
        assert.equal(result.port25.ok, false);
        assert.match(result.port25.reason, /SMTP port 25 unreachable/);
        assert.equal(result.degraded, true);
    } finally {
        proxy.close();
    }
});
