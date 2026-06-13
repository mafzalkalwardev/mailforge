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

function renderCampaignEmail(campaign, row, sender) {
    const ctx = buildContext(row, sender, campaign);
    const subjectTpl = pickRandom(campaign.subjectTemplates) || campaign.subjectTemplate || 'Hello';
    const bodyTpl = pickRandom(campaign.bodyTemplates) || campaign.bodyTemplate || 'Hi {Name},\n\n';
    return {
        subject: renderTemplate(subjectTpl, ctx),
        body: renderTemplate(bodyTpl, ctx),
    };
}

module.exports = { renderTemplate, buildContext, renderCampaignEmail, pickRandom };
