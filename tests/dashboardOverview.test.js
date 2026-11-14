const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('dashboard still loads the overview when the stats request fails', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
    const script = [...html.matchAll(/<script>\s*([\s\S]*?)<\/script>/g)]
        .map(m => m[1])
        .find(src => src.includes("'DOMContentLoaded'"));
    assert.ok(script, 'inline dashboard script not found');

    const elements = {};
    const el = id => (elements[id] ??= { id, innerText: '', textContent: '—', innerHTML: '', classList: { remove() {} }, getContext: () => ({}) });
    let onReady;
    const sandbox = {
        document: {
            documentElement: { getAttribute: () => 'light' },
            getElementById: el,
            addEventListener: (_, fn) => { onReady = fn; },
        },
        axios: {
            get: url => url === '/api/history/stats'
                ? Promise.reject(new Error('stats down'))
                : Promise.resolve({ data: {
                    inbox: { unread: 7 },
                    campaigns: { running: 2 },
                    suppression: { total: 3 },
                    senders: [{ email: 'a@example.com', sentToday: 1, dailyLimit: 10, remaining: 9, enabled: true }],
                    onboarding: { completedSteps: 4 },
                } }),
        },
        Chart: function () {},
        showToast: () => {},
    };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    await onReady();

    assert.equal(elements.cmdUnread?.textContent, 7, 'overview must still fill cmdUnread when stats fails');
    assert.equal(elements.cmdRunning?.textContent, 2, 'overview must still fill cmdRunning when stats fails');
});
