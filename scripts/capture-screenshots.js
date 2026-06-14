/**
 * Capture MailForge UI screenshots for README/docs.
 * Usage: node scripts/capture-screenshots.js
 * Optional: SCREENSHOT_EMAIL and SCREENSHOT_PASSWORD env vars for authenticated pages.
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.SCREENSHOT_BASE || 'http://localhost:5000';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

async function main() {
    let puppeteer;
    try {
        puppeteer = require('puppeteer');
    } catch {
        console.error('Install puppeteer: npm install --save-dev puppeteer');
        process.exit(1);
    }

    fs.mkdirSync(OUT, { recursive: true });

    const browser = await puppeteer.launch({
        headless: 'new',
        defaultViewport: { width: 1440, height: 900 },
        args: ['--no-sandbox'],
    });

    const page = await browser.newPage();

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function shot(name, url, opts = {}) {
        console.log(`Capturing ${name}...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        if (opts.dark) {
            await page.evaluate(() => {
                document.documentElement.setAttribute('data-bs-theme', 'dark');
                document.body.classList.add('dark-mode');
            });
            await sleep(400);
        }
        if (opts.waitMs) await sleep(opts.waitMs);
        await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: opts.fullPage !== false });
    }

    await shot('login', `${BASE}/`);
    await shot('login-dark', `${BASE}/`, { dark: true });

    let email = process.env.SCREENSHOT_EMAIL;
    let password = process.env.SCREENSHOT_PASSWORD;

    if (!email || !password) {
        email = `screenshot-${Date.now()}@mailforge.local`;
        password = 'ScreenshotPass123!';
        try {
            const axios = require('axios');
            await axios.post(`${BASE}/api/auth/register`, {
                name: 'Screenshot Demo',
                email,
                password,
            });
            console.log(`Created demo user ${email}`);
        } catch (e) {
            console.warn('Could not register demo user:', e.response?.data?.message || e.message);
            email = null;
        }
    }

    if (email && password) {
        await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
        await page.type('#email', email);
        await page.type('#password', password);
        await page.click('#loginForm button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

        await shot('dashboard', `${BASE}/dashboard.html`, { waitMs: 2000 });
        await shot('dashboard-dark', `${BASE}/dashboard.html`, { dark: true, waitMs: 1000 });
        await shot('inbox', `${BASE}/inbox.html`, { waitMs: 1500 });
        await shot('templates', `${BASE}/templates.html`, { waitMs: 1500 });
        await shot('suppression', `${BASE}/suppression.html`, { waitMs: 1000 });
        await shot('senders-dark', `${BASE}/senders.html`, { dark: true, waitMs: 1000 });
        await shot('bulk-import-dark', `${BASE}/bulk.html`, { dark: true, waitMs: 1000 });

        await page.goto(`${BASE}/templates.html`, { waitUntil: 'networkidle2' });
        await page.evaluate(() => document.documentElement.setAttribute('data-bs-theme', 'dark'));
        const newTpl = await page.$('[data-bs-target="#templateModal"]');
        if (newTpl) {
            await newTpl.click();
            await sleep(600);
            await page.screenshot({ path: path.join(OUT, 'templates-modal-dark.png') });
        }
    } else {
        console.log('Skipping authenticated screenshots.');
    }

    await browser.close();
    console.log(`Screenshots saved to ${OUT}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
