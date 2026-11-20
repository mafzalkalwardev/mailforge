const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const { version } = require('../package.json');

const hardcodedFooter = /Self-hosted[^\n]*(\d+\.\d+|v\d|\$\{\s*['"`])/;
const hardcodedScript = /\bAPP_VERSION\s*=|['"`]\d+\.\d+\.\d+['"`]/;

function makeElement() {
    return {
        textContent: '',
        innerHTML: '',
        className: '',
        dataset: {},
        children: [],
        classList: { add() {}, remove() {} },
        appendChild(child) { this.children.push(child); return child; },
        insertAdjacentElement() {},
    };
}

function runSidebar(metaVersion) {
    const footerSmall = makeElement();
    const nav = makeElement();
    const sidebar = makeElement();
    sidebar.querySelector = sel => sidebar.children.find(c => c.className.includes(sel.slice(1))) || null;
    const body = makeElement();
    const listeners = {};
    const meta = metaVersion === null ? null : { content: metaVersion };
    const document = {
        body,
        querySelector(sel) {
            if (sel === '.sidebar nav.nav') return nav;
            if (sel === '.sidebar') return sidebar;
            if (sel === 'meta[name="mailforge-version"]') return meta;
            return null;
        },
        querySelectorAll(sel) {
            return sel === '.sidebar-footer small' ? [footerSmall] : [];
        },
        createElement: () => makeElement(),
        addEventListener(type, fn) { listeners[type] = fn; },
        dispatchEvent() {},
    };
    const sandbox = {
        window: { location: { pathname: '/dashboard.html' } },
        document,
        localStorage: { getItem: () => null },
        CustomEvent: class { constructor(type) { this.type = type; } },
        setInterval: () => 0,
        console,
    };
    vm.runInNewContext(fs.readFileSync(path.join(publicDir, 'js', 'sidebar.js'), 'utf8'), sandbox);
    listeners.DOMContentLoaded();
    return { footerSmall };
}

describe('sidebar version footer', () => {
    it('does not hardcode a version in any page or in sidebar.js', () => {
        const files = [...fs.readdirSync(publicDir).filter(f => f.endsWith('.html')), 'js/sidebar.js'];
        const hardcoded = [];
        for (const file of files) {
            const lines = fs.readFileSync(path.join(publicDir, file), 'utf8').split(/\r?\n/);
            lines.forEach((line, i) => {
                if (hardcodedFooter.test(line) || hardcodedScript.test(line)) {
                    hardcoded.push(`${file}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        assert.deepEqual(hardcoded, []);
    });

    it('shows the package.json version passed by the server', () => {
        const { footerSmall } = runSidebar(version);
        assert.equal(footerSmall.textContent, `Self-hosted · v${version}`);
    });

    it('shows a non-blank footer when the server sends no version', () => {
        const { footerSmall } = runSidebar(null);
        assert.equal(footerSmall.textContent, 'Self-hosted');
    });
});
