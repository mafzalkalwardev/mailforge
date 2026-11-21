const net = require('net');

const DEFAULT_PROBE_HOST = 'gmail-smtp-in.l.google.com';
const CACHE_MS = 30000;
const cache = new Map();

function parseProxy(proxyUrl) {
    const parsed = new URL(proxyUrl);
    const scheme = String(parsed.protocol || '').replace(':', '').toLowerCase();
    if (!['socks5:', 'socks5h:', 'socks4:', 'socks4a:'].includes(parsed.protocol)) {
        throw new Error(`unsupported proxy scheme ${scheme}`);
    }
    const port = parseInt(parsed.port || '1080', 10);
    if (!parsed.hostname || !Number.isFinite(port)) throw new Error('proxy endpoint missing');
    return {
        host: parsed.hostname,
        port,
        username: parsed.username || '',
        password: parsed.password || '',
    };
}

function tcpConnect(host, port, timeoutMs) {
    return new Promise(resolve => {
        const socket = net.connect({ host, port });
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);
        socket.once('connect', () => finish({ ok: true }));
        socket.once('error', err => finish({ ok: false, error: err.message }));
    });
}

function socks5Connect(proxy, targetHost, targetPort, timeoutMs) {
    return new Promise(resolve => {
        const socket = net.connect({ host: proxy.host, port: proxy.port });
        let buf = Buffer.alloc(0);
        let stage = 'greeting';
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => {
            finish({ ok: false, stage: stage === 'connect' ? 'target' : 'proxy', error: 'timeout' });
        }, timeoutMs);

        function writeConnect() {
            const hostBuf = Buffer.from(targetHost);
            if (hostBuf.length > 255) {
                finish({ ok: false, stage: 'target', error: 'hostname too long' });
                return;
            }
            const packet = Buffer.alloc(7 + hostBuf.length);
            packet[0] = 0x05;
            packet[1] = 0x01;
            packet[2] = 0x00;
            packet[3] = 0x03;
            packet[4] = hostBuf.length;
            hostBuf.copy(packet, 5);
            packet.writeUInt16BE(targetPort, 5 + hostBuf.length);
            socket.write(packet);
        }

        socket.once('error', err => finish({ ok: false, stage: 'proxy', error: err.message }));
        socket.on('connect', () => {
            if (proxy.username) socket.write(Buffer.from([0x05, 0x01, 0x02]));
            else socket.write(Buffer.from([0x05, 0x01, 0x00]));
        });
        socket.on('data', chunk => {
            buf = Buffer.concat([buf, chunk]);
            if (stage === 'greeting') {
                if (buf.length < 2) return;
                const method = buf[1];
                buf = buf.subarray(2);
                if (method === 0x02) {
                    stage = 'auth';
                    const user = Buffer.from(proxy.username || '');
                    const pass = Buffer.from(proxy.password || '');
                    socket.write(Buffer.concat([
                        Buffer.from([0x01, user.length]),
                        user,
                        Buffer.from([pass.length]),
                        pass,
                    ]));
                } else if (method === 0x00) {
                    stage = 'connect';
                    writeConnect();
                } else {
                    finish({ ok: false, stage: 'proxy', error: 'socks auth rejected' });
                    return;
                }
            }
            if (stage === 'auth') {
                if (buf.length < 2) return;
                if (buf[1] !== 0x00) {
                    finish({ ok: false, stage: 'proxy', error: 'socks auth failed' });
                    return;
                }
                buf = buf.subarray(2);
                stage = 'connect';
                writeConnect();
            }
            if (stage === 'connect') {
                if (buf.length < 5) return;
                if (buf[1] !== 0x00) {
                    finish({ ok: false, stage: 'target', error: `socks connect failed (${buf[1]})` });
                    return;
                }
                finish({ ok: true, stage: 'target' });
            }
        });
    });
}

function baseResult(proxyUrl, probeHost, port) {
    return {
        proxy: {
            configured: Boolean(proxyUrl),
            reachable: null,
            endpoint: null,
            reason: null,
        },
        port25: {
            ok: false,
            via: proxyUrl ? 'proxy' : 'direct',
            host: `${probeHost}:${port}`,
            reason: null,
        },
        degraded: true,
    };
}

async function checkSmtpPath(options = {}) {
    const timeoutMs = options.timeoutMs || 5000;
    const proxyUrl = options.proxy !== undefined
        ? String(options.proxy || '').trim()
        : String(process.env.SMTP_PROXY || '').trim();
    const probeHost = options.probeHost || process.env.SMTP_PROBE_HOST || DEFAULT_PROBE_HOST;
    const port = Number(options.port || process.env.SMTP_PORT || 25);
    const cacheKey = JSON.stringify({ proxyUrl, probeHost, port });

    if (!options.skipCache) {
        const hit = cache.get(cacheKey);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    }

    const result = baseResult(proxyUrl, probeHost, port);

    if (proxyUrl) {
        let proxy;
        try {
            proxy = parseProxy(proxyUrl);
        } catch (_) {
            result.proxy.reachable = false;
            result.proxy.reason = 'verification proxy offline';
            result.port25.reason = 'verification proxy offline';
            return remember(cacheKey, result, options.skipCache);
        }
        result.proxy.endpoint = `${proxy.host}:${proxy.port}`;
        const opened = await tcpConnect(proxy.host, proxy.port, Math.min(timeoutMs, 4000));
        if (!opened.ok) {
            result.proxy.reachable = false;
            result.proxy.reason = 'verification proxy offline';
            result.port25.reason = 'verification proxy offline';
            return remember(cacheKey, result, options.skipCache);
        }
        result.proxy.reachable = true;
        const socks = await socks5Connect(proxy, probeHost, port, timeoutMs);
        if (!socks.ok && socks.stage === 'proxy') {
            result.proxy.reachable = false;
            result.proxy.reason = 'verification proxy offline';
            result.port25.reason = 'verification proxy offline';
            return remember(cacheKey, result, options.skipCache);
        }
        result.port25.ok = !!socks.ok;
        result.port25.reason = socks.ok ? null : 'SMTP port 25 unreachable from this server';
        result.degraded = !socks.ok;
        return remember(cacheKey, result, options.skipCache);
    }

    const direct = await tcpConnect(probeHost, port, timeoutMs);
    result.port25.ok = direct.ok;
    result.port25.reason = direct.ok ? null : 'SMTP port 25 unreachable from this server';
    result.degraded = !direct.ok;
    return remember(cacheKey, result, options.skipCache);
}

function remember(key, value, skipCache) {
    if (!skipCache) cache.set(key, { at: Date.now(), value });
    return value;
}

function formatSmtpPathLog(result) {
    if (!result) return 'SMTP path unknown';
    if (!result.degraded && result.port25?.ok) {
        const via = result.port25.via === 'proxy'
            ? `proxy ${result.proxy?.endpoint || ''}`.trim()
            : 'direct';
        return `SMTP port 25 reachable via ${via}`;
    }
    return `SMTP verification degraded (${result.port25?.via || 'direct'}): ${result.port25?.reason || result.proxy?.reason || 'unknown'}`;
}

module.exports = {
    checkSmtpPath,
    formatSmtpPathLog,
    parseProxy,
};
