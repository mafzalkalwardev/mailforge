const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../server');

let server;
let base;

function request(path) {
    return new Promise((resolve, reject) => {
        http.get(base + path, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString('utf8'),
                });
            });
        }).on('error', reject);
    });
}

function jsonLd(html) {
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(match, 'JSON-LD script missing');
    return JSON.parse(match[1]);
}

describe('public landing page', () => {
    before(() => new Promise((resolve) => {
        server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            base = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    }));

    after(() => new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
    }));

    it('serves a crawlable landing page at /', async () => {
        const res = await request('/');
        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /text\/html/);
        assert.equal((res.body.match(/<h1[\s>]/g) || []).length, 1);
        assert.match(res.body, /What is MailForge\?/);
        assert.match(res.body, /href="\/login"/);
        assert.match(res.body, /href="\/login\?register=1"/);
        assert.match(res.body, /rel="canonical" href="https:\/\/mailforge\.induswebagency\.com\/"/);
        assert.match(res.body, /\/media\/hero\.avif/);
        assert.match(res.body, /loading="lazy"/);
        assert.doesNotMatch(res.body, /<script src=/);

        const graph = jsonLd(res.body)['@graph'];
        const types = graph.map((node) => node['@type']);
        for (const type of ['Organization', 'WebSite', 'SoftwareApplication', 'BreadcrumbList', 'HowTo', 'FAQPage']) {
            assert.ok(types.includes(type), `missing ${type}`);
        }
        assert.equal(graph.find((node) => node['@type'] === 'Organization').name, 'INDUS Web Agency');
        assert.equal(graph.find((node) => node['@type'] === 'Organization').url, 'https://induswebagency.com');

        const faq = graph.find((node) => node['@type'] === 'FAQPage');
        assert.equal(faq.mainEntity.length, 7);
        for (const question of faq.mainEntity) {
            assert.match(res.body, new RegExp(`<h3>${question.name.replace(/[?]/g, '\\?')}</h3>`));
            assert.ok(res.body.includes(question.acceptedAnswer.text), question.name);
        }

        const howto = graph.find((node) => node['@type'] === 'HowTo');
        assert.equal(howto.name, 'How to verify an email list with MailForge');
        assert.equal(howto.step.length, 4);
        for (const step of howto.step) {
            assert.ok(res.body.includes(step.text), step.name);
            assert.match(res.body, new RegExp(`<h3>${step.name}</h3>`));
        }
        assert.equal(graph.find((node) => node['@type'] === 'SoftwareApplication').offers, undefined);
    });

    it('moves login to /login and redirects the old expired-session link', async () => {
        const login = await request('/login');
        assert.equal(login.status, 200);
        assert.match(login.body, /id="loginForm"/);
        assert.match(login.body, /id="registerForm"/);
        assert.match(login.body, /noindex/);
        assert.match(login.body, /get\('register'\)/);

        const slash = await request('/login/');
        assert.equal(slash.status, 200);
        assert.match(slash.body, /id="loginForm"/);

        const file = await request('/login.html');
        assert.equal(file.status, 200);
        assert.match(file.body, /Sign In/);

        const expired = await request('/?expired=1');
        assert.equal(expired.status, 302);
        assert.equal(expired.headers.location, '/login?expired=1');
    });

    it('serves robots, sitemap, and llms files with explicit content types', async () => {
        const robots = await request('/robots.txt');
        assert.equal(robots.status, 200);
        assert.match(robots.headers['content-type'], /^text\/plain/);
        for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended']) {
            assert.ok(robots.body.includes(bot), bot);
        }
        assert.match(robots.body, /Sitemap: https:\/\/mailforge\.induswebagency\.com\/sitemap\.xml/);
        assert.match(robots.body, /Disallow: \/api\//);
        assert.match(robots.body, /Allow: \/llms\.txt/);

        const sitemap = await request('/sitemap.xml');
        assert.equal(sitemap.status, 200);
        assert.match(sitemap.headers['content-type'], /^application\/xml/);
        assert.match(sitemap.body, /<loc>https:\/\/mailforge\.induswebagency\.com\/<\/loc>/);

        const llms = await request('/llms.txt');
        assert.equal(llms.status, 200);
        assert.match(llms.headers['content-type'], /^text\/plain/);
        assert.match(llms.body, /^# MailForge/);
        assert.match(llms.body, /https:\/\/induswebagency\.com/);

        const full = await request('/llms-full.txt');
        assert.equal(full.status, 200);
        assert.match(full.headers['content-type'], /^text\/plain/);
        assert.match(full.body, /How to verify an email list/);
    });

    it('keeps existing public app routes', async () => {
        const unsubscribe = await request('/unsubscribe.html');
        assert.equal(unsubscribe.status, 200);
        assert.match(unsubscribe.body, /Unsubscribe/);
        assert.match(unsubscribe.body, /\/api\/suppression\/unsubscribe/);

        const dashboard = await request('/dashboard.html');
        assert.equal(dashboard.status, 200);
        assert.match(dashboard.body, /Dashboard/);

        const hero = await request('/media/hero.avif');
        assert.equal(hero.status, 200);
        assert.match(hero.headers['content-type'], /image\/avif/);

        const og = await request('/media/og.png');
        assert.equal(og.status, 200);
        assert.match(og.headers['content-type'], /image\/png/);

        const icon = await request('/favicon.ico');
        assert.equal(icon.status, 200);
        assert.match(icon.headers['content-type'], /image\/svg\+xml/);
    });
});
