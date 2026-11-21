const net = require('net');
const axios = require('axios');

const PORT25_REASON = 'SMTP port 25 unreachable from this server';
const DEFAULT_PROBE_HOST = process.env.SMTP_PROBE_HOST || 'aspmx.l.google.com';
const CACHE_MS = 60 * 1000;
const cache = new Map();

function goBase() {
    return String(process.env.GO_VERIFIER_URL || `http://localhost:${process.env.VERIFIER_GO_PORT || 8082}`).replace(/\/$/, '');
}

function probePort() {
    const port = parseInt(process.env.SMTP_PORT || '25', 10);
    return Number.isFinite(port) && port > 0 ? port : 25;
}

function createBufferedReader(socket, timeoutMs) {
    let buf = Buffer.alloc(0);
    let waiters = [];
    const onData = chunk => {
        buf = Buffer.concat([buf, chunk]);
        waiters.slice().forEach(fn => fn());
    };
    socket.on('data', onData);
    function take(size) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                waiters = waiters.filter(fn => fn !== check);
                reject(new Error('SMTP proxy timeout'));
            }, timeoutMs);
            function check() {
                if (buf.length < size) return;
                clearTimeout(timer);
                waiters = waiters.filter(fn => fn !== check);
                const out = buf.subarray(0, size);
                buf = buf.subarray(size);
                resolve(out);
            }
            waiters.push(check);
            check();
        });
    }
    return {
        take,
        rest() {
            const out = buf;
            buf = Buffer.alloc(0);
            socket.off('data', onData);
            return out;
        },
        stop() {
            socket.off('data', onData);
        },
    };
}

function connectSocks5(proxyUrl, destHost, destPort, timeoutMs) {
    const parsed = new URL(proxyUrl);
    const proxyHost = parsed.hostname;
    const proxyPort = Number(parsed.port || 1080);
    const user = decodeURIComponent(parsed.username || '');
    const pass = decodeURIComponent(parsed.password || '');
    if (!['socks5:', 'socks5h:', 'socks4:', 'socks4a:'].includes(parsed.protocol)) {
        return Promise.reject(new Error('invalid SMTP proxy URL'));
    }

    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: proxyHost, port: proxyPort });
        const timer = setTimeout(() => fail(new Error('SMTP proxy timeout')), timeoutMs);
        let reader;
        function fail(err) {
            clearTimeout(timer);
            if (reader) reader.stop();
            socket.destroy();
            reject(err);
        }
        socket.once('error', fail);
        socket.once('connect', async () => {
            reader = createBufferedReader(socket, timeoutMs);
            try {
                const greeting = user
                    ? Buffer.from([0x05, 0x02, 0x00, 0x02])
                    : Buffer.from([0x05, 0x01, 0x00]);
                socket.write(greeting);
                const method = await reader.take(2);
                if (method[0] !== 0x05 || method[1] === 0xff) {
                    throw new Error('SMTP proxy rejected authentication methods');
                }
                if (method[1] === 0x02) {
                    const userBuf = Buffer.from(user);
                    const passBuf = Buffer.from(pass);
                    socket.write(Buffer.concat([
                        Buffer.from([0x01, userBuf.length]),
                        userBuf,
                        Buffer.from([passBuf.length]),
                        passBuf,
                    ]));
                    const auth = await reader.take(2);
                    if (auth[1] !== 0x00) throw new Error('SMTP proxy authentication failed');
                } else if (method[1] !== 0x00) {
                    throw new Error('SMTP proxy authentication failed');
                }

                const hostBuf = Buffer.from(destHost);
                socket.write(Buffer.concat([
                    Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
                    hostBuf,
                    Buffer.from([(destPort >> 8) & 0xff, destPort & 0xff]),
                ]));
                const head = await reader.take(4);
                if (head[1] !== 0x00) throw new Error('SMTP proxy could not connect to port 25');
                let addrLen = 0;
                if (head[3] === 0x01) addrLen = 4;
                else if (head[3] === 0x04) addrLen = 16;
                else if (head[3] === 0x03) {
                    const len = await reader.take(1);
                    addrLen = len[0];
                } else {
                    throw new Error('SMTP proxy returned an unexpected address type');
                }
                await reader.take(addrLen + 2);
                const buffered = reader.rest();
                clearTimeout(timer);
                socket.removeAllListeners('error');
                resolve({ socket, buffered });
            } catch (err) {
                fail(err);
            }
        });
    });
}

function readBanner(socket, timeoutMs, initial) {
    return new Promise((resolve, reject) => {
        let buf = initial && initial.length ? Buffer.from(initial) : Buffer.alloc(0);
        const timer = setTimeout(() => {
            cleanup();
            if (buf.length) resolve(buf.toString('utf8'));
            else reject(new Error('i/o timeout'));
        }, timeoutMs);
        function onData(chunk) {
            buf = Buffer.concat([buf, chunk]);
            if (buf.includes(0x0a) || buf.length >= 3) {
                cleanup();
                resolve(buf.toString('utf8'));
            }
        }
        function onError(err) {
            cleanup();
            if (buf.length) resolve(buf.toString('utf8'));
            else reject(err);
        }
        function cleanup() {
            clearTimeout(timer);
            socket.off('data', onData);
            socket.off('error', onError);
        }
        if (buf.length >= 3 || buf.includes(0x0a)) {
            cleanup();
            resolve(buf.toString('utf8'));
            return;
        }
        socket.on('data', onData);
        socket.on('error', onError);
    });
}

function bannerReached(text) {
    return /^\s*[245]\d\d/.test(String(text || ''));
}

async function probeBanner({ host, port, proxy, timeoutMs = 5000 }) {
    let socket;
    try {
        let buffered = Buffer.alloc(0);
        if (proxy) {
            const connected = await connectSocks5(proxy, host, port, timeoutMs);
            socket = connected.socket;
            buffered = connected.buffered;
        } else {
            socket = await new Promise((resolve, reject) => {
                const sock = net.connect({ host, port });
                const timer = setTimeout(() => {
                    sock.destroy();
                    reject(new Error('i/o timeout'));
                }, timeoutMs);
                sock.once('connect', () => {
                    clearTimeout(timer);
                    resolve(sock);
                });
                sock.once('error', err => {
                    clearTimeout(timer);
                    reject(err);
                });
            });
        }
        const banner = await readBanner(socket, timeoutMs, buffered);
        socket.end();
        if (bannerReached(banner)) {
            return { ok: true, detail: banner.trim() };
        }
        return { ok: false, detail: `${PORT25_REASON}: ${banner.trim() || 'no SMTP banner'}` };
    } catch (err) {
        if (socket) socket.destroy();
        const message = err.message || String(err);
        if (proxy && /proxy|socks|auth/i.test(message)) {
            return { ok: false, detail: `SMTP proxy unreachable: ${message}` };
        }
        if (/invalid SMTP proxy/i.test(message)) {
            return { ok: false, detail: message };
        }
        return { ok: false, detail: `${PORT25_REASON}: ${message}` };
    }
}

function buildReport(direct, proxyResult, proxy) {
    const proxyConfigured = Boolean(proxy);
    const report = {
        reachable: proxyConfigured ? Boolean(proxyResult && proxyResult.ok) : Boolean(direct && direct.ok),
        direct_reachable: Boolean(direct && direct.ok),
        proxy_configured: proxyConfigured,
        proxy_reachable: Boolean(proxyResult && proxyResult.ok),
        via: proxyConfigured ? 'proxy' : 'direct',
        checked_at: new Date().toISOString(),
        pending: false,
    };
    if (report.reachable && proxyConfigured && !report.direct_reachable) {
        report.detail = 'Direct port 25 is blocked; SMTP proxy can reach port 25';
    } else if (report.reachable && proxyConfigured) {
        report.detail = 'Outbound SMTP port 25 is reachable through the configured proxy';
    } else if (report.reachable) {
        report.detail = 'Outbound SMTP port 25 is reachable';
    } else if (proxyConfigured && proxyResult) {
        report.detail = proxyResult.detail;
    } else {
        report.detail = (direct && direct.detail) || PORT25_REASON;
    }
    return report;
}

async function checkPort25Direct({ proxy = '', host = DEFAULT_PROBE_HOST, port = probePort(), timeoutMs = 5000 } = {}) {
    const directPromise = probeBanner({ host, port, timeoutMs });
    const proxyPromise = proxy
        ? probeBanner({ host, port, proxy, timeoutMs })
        : Promise.resolve(null);
    const [direct, viaProxy] = await Promise.all([directPromise, proxyPromise]);
    return buildReport(direct, viaProxy, proxy);
}

async function getPort25Status({ proxy = process.env.SMTP_PROXY || '', force = false, host, port, timeoutMs } = {}) {
    const key = `${proxy || 'direct'}|${host || DEFAULT_PROBE_HOST}|${port || probePort()}`;
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await checkPort25Direct({ proxy, host, port, timeoutMs });
    cache.set(key, { at: Date.now(), value });
    return value;
}

async function resolvePort25({ proxy = process.env.SMTP_PROXY || '', goUrl = goBase() } = {}) {
    try {
        const headers = { 'X-Mailforge-Smtp-Override': '1' };
        if (proxy) headers['X-Mailforge-Smtp-Proxy'] = proxy;
        const res = await axios.get(`${goUrl}/port25`, {
            timeout: 12000,
            headers,
            validateStatus: () => true,
        });
        if (res.status >= 200 && res.status < 300 && res.data && typeof res.data.reachable === 'boolean' && !res.data.pending) {
            return res.data;
        }
    } catch (_) {
        // The Go verifier may be down; fall back to a local TCP/SOCKS probe.
    }
    return getPort25Status({ proxy });
}

function notePort25OnStartup() {
    resolvePort25()
        .then(report => {
            const state = report.reachable ? 'reachable' : 'degraded';
            console.log(`SMTP port 25 self-check (${report.via || 'direct'}, ${state}): ${report.detail}`);
        })
        .catch(err => {
            console.warn('SMTP port 25 self-check failed:', err.message);
        });
}

module.exports = {
    PORT25_REASON,
    probeBanner,
    buildReport,
    getPort25Status,
    resolvePort25,
    notePort25OnStartup,
    connectSocks5,
};
