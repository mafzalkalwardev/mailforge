const test = require('node:test');
const assert = require('node:assert/strict');
const { verifierRequestHeaders } = require('../utils/verificationEngine');

test('Go verifier request carries the SOCKS proxy and SMTP identity', () => {
    const previous = {
        helo: process.env.SMTP_HELO,
        from: process.env.SMTP_FROM,
        proxy: process.env.SMTP_PROXY,
    };
    process.env.SMTP_HELO = 'mail.example.com';
    process.env.SMTP_FROM = 'verify@example.com';
    delete process.env.SMTP_PROXY;

    try {
        const headers = verifierRequestHeaders({ smtpProxy: 'socks5://127.0.0.1:1080' });
        assert.equal(headers['X-Mailforge-Smtp-Proxy'], 'socks5://127.0.0.1:1080');
        assert.equal(headers['X-Mailforge-Smtp-Helo'], 'mail.example.com');
        assert.equal(headers['X-Mailforge-Smtp-From'], 'verify@example.com');
    } finally {
        if (previous.helo === undefined) delete process.env.SMTP_HELO;
        else process.env.SMTP_HELO = previous.helo;
        if (previous.from === undefined) delete process.env.SMTP_FROM;
        else process.env.SMTP_FROM = previous.from;
        if (previous.proxy === undefined) delete process.env.SMTP_PROXY;
        else process.env.SMTP_PROXY = previous.proxy;
    }
});

test('server SMTP_PROXY is sent when the user has not set one', () => {
    const previous = process.env.SMTP_PROXY;
    process.env.SMTP_PROXY = 'socks5://127.0.0.1:1080';
    try {
        const headers = verifierRequestHeaders({});
        assert.equal(headers['X-Mailforge-Smtp-Proxy'], 'socks5://127.0.0.1:1080');
    } finally {
        if (previous === undefined) delete process.env.SMTP_PROXY;
        else process.env.SMTP_PROXY = previous;
    }
});
