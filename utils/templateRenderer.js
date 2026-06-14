const PLACEHOLDER_RE = /\{(\w+)\}/g;

function safeStr(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    const s = String(value).trim();
    return s || fallback;
}

function renderTemplate(template, context) {
    if (!template) return '';
    return template.replace(PLACEHOLDER_RE, (_, key) => {
        const val = context[key];
        return val !== undefined && val !== null ? String(val) : '';
    });
}

function buildContext(row, sender, campaign) {
    const ctx = {
        SENDER_NAME: safeStr(sender?.displayName, sender?.email || ''),
        SENDER_EMAIL: safeStr(sender?.email),
        COMPANY_NAME: safeStr(campaign?.companyName, ''),
        Name: 'there',
        Email: '',
        State: '',
        state: '',
    };

    if (row && typeof row === 'object') {
        for (const [k, v] of Object.entries(row)) {
            const key = safeStr(k);
            if (!key) continue;
            ctx[key] = safeStr(v);
            ctx[key.toLowerCase()] = safeStr(v);
        }
        ctx.Name = safeStr(row.Name || row.name, ctx.Name);
        ctx.Email = safeStr(row.Email || row.email, ctx.Email);
        const stateVal = safeStr(row.State || row.state, 'N/A');
        ctx.State = stateVal.toUpperCase();
        ctx.state = stateVal;
    }

    return ctx;
}

function pickRandom(items) {
    if (!Array.isArray(items) || !items.length) return '';
    return items[Math.floor(Math.random() * items.length)];
}

const { signUnsubscribeToken } = require('./unsubscribeToken');

function appendUnsubscribeFooter(body, userId, recipientEmail, baseUrl) {
    const token = signUnsubscribeToken(userId, recipientEmail);
    const url = `${baseUrl.replace(/\/$/, '')}/unsubscribe.html?token=${encodeURIComponent(token)}`;
    return `${body}\n\n---\nTo stop receiving emails, unsubscribe here:\n${url}`;
}

function renderCampaignEmail(campaign, row, sender, options = {}) {
    const ctx = buildContext(row, sender, campaign);
    const subjectTpl = pickRandom(campaign.subjectTemplates) || campaign.subjectTemplate || 'Hello';
    const bodyTpl = pickRandom(campaign.bodyTemplates) || campaign.bodyTemplate || 'Hi {Name},\n\n';
    let body = renderTemplate(bodyTpl, ctx);
    if (campaign.settings?.appendUnsubscribe !== false && options.userId && row?.Email) {
        const baseUrl = options.baseUrl || process.env.APP_BASE_URL || 'http://localhost:5000';
        body = appendUnsubscribeFooter(body, options.userId, row.Email, baseUrl);
    }
    return {
        subject: renderTemplate(subjectTpl, ctx),
        body,
    };
}

module.exports = { renderTemplate, buildContext, renderCampaignEmail, pickRandom, appendUnsubscribeFooter };
