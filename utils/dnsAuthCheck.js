const dns = require('dns').promises;

function flattenTxt(records) {
    return (records || []).map(r => (Array.isArray(r) ? r.join('') : String(r)));
}

async function resolveTxtSafe(name) {
    try {
        return flattenTxt(await dns.resolveTxt(name));
    } catch {
        return [];
    }
}

function checkSpf(txtRecords) {
    const spf = txtRecords.find(r => r.toLowerCase().startsWith('v=spf1'));
    if (!spf) return { ok: false, detail: 'No SPF record found' };
    const hasGoogle = /include:_spf\.google\.com|include:google\.com/i.test(spf);
    return { ok: true, detail: hasGoogle ? 'SPF found (Google)' : `SPF found: ${spf.slice(0, 80)}` };
}

function checkDmarc(dmarcRecords) {
    const dmarc = dmarcRecords.find(r => r.toLowerCase().startsWith('v=dmarc1'));
    if (!dmarc) return { ok: false, detail: 'No DMARC record at _dmarc' };
    const policy = (dmarc.match(/p=(\w+)/i) || [])[1] || 'unknown';
    return { ok: policy !== 'none', detail: `DMARC p=${policy}` };
}

async function checkDkim(domain) {
    const selectors = ['google', 'default', 'k1', 's1', 'selector1', 'selector2'];
    for (const sel of selectors) {
        const recs = await resolveTxtSafe(`${sel}._domainkey.${domain}`);
        const dkim = recs.find(r => r.toLowerCase().includes('v=dkim1') || r.toLowerCase().includes('k=rsa'));
        if (dkim) return { ok: true, detail: `DKIM selector ${sel}` };
    }
    return { ok: false, detail: 'No common DKIM selectors found (Gmail may still sign mail)' };
}

async function checkDomainAuth(email) {
    const domain = String(email || '').split('@')[1]?.toLowerCase().trim();
    if (!domain) {
        return { domain: '', spf: { ok: false }, dmarc: { ok: false }, dkim: { ok: false }, score: 0, warnings: ['Invalid email'] };
    }

    const [rootTxt, dmarcTxt] = await Promise.all([
        resolveTxtSafe(domain),
        resolveTxtSafe(`_dmarc.${domain}`),
    ]);
    const spf = checkSpf(rootTxt);
    const dmarc = checkDmarc(dmarcTxt);
    const dkim = await checkDkim(domain);

    const score = [spf.ok, dmarc.ok, dkim.ok].filter(Boolean).length;
    const warnings = [];
    if (!spf.ok) warnings.push('Missing SPF — deliverability risk');
    if (!dmarc.ok) warnings.push('Missing or weak DMARC');
    if (!dkim.ok) warnings.push('DKIM not detected (common for Gmail senders)');

    return {
        domain,
        spf,
        dmarc,
        dkim,
        score,
        maxScore: 3,
        warnings,
        checkedAt: new Date().toISOString(),
    };
}

async function checkSendersDns(senders) {
    const results = [];
    for (const sender of senders) {
        const auth = await checkDomainAuth(sender.email);
        results.push({ senderId: sender._id, email: sender.email, ...auth });
    }
    return results;
}

module.exports = { checkDomainAuth, checkSendersDns, resolveTxtSafe };
