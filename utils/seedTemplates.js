const User = require('../models/User');
const EmailTemplate = require('../models/EmailTemplate');
const {
    FREIGHT_DISPATCH_NAME,
    FREIGHT_DISPATCH_TEMPLATE,
    FREIGHT_VARIANT_TEMPLATES,
} = require('./freightDispatchTemplates');

const BUILT_IN_TEMPLATE_NAMES = new Set([
    FREIGHT_DISPATCH_NAME,
    ...FREIGHT_VARIANT_TEMPLATES.map(t => t.name),
]);

const STARTER_TEMPLATES = [
    {
        name: 'Soft Introduction',
        companyName: 'Your Company',
        subjectTemplates: [
            'Quick note for {Name}',
            '{COMPANY_NAME} — thought of you',
            'Reaching out, {Name}',
        ],
        bodyTemplates: [
            `Hi {Name},

I'm {SENDER_NAME} with {COMPANY_NAME}. I came across your contact and wanted to reach out briefly.

We help teams like yours streamline operations. If that's on your radar, I'd love to share a quick overview — no pressure at all.

Would a short reply work for you?

Best,
{SENDER_NAME}
{COMPANY_NAME}`,
        ],
    },
    {
        name: 'Follow-Up',
        companyName: 'Your Company',
        subjectTemplates: [
            'Following up — {Name}',
            'Re: {COMPANY_NAME}',
            'Circling back, {Name}',
        ],
        bodyTemplates: [
            `Hi {Name},

I wanted to follow up on my earlier note from {COMPANY_NAME}.

If now isn't the right time, no worries — just let me know. Otherwise, I'm happy to answer any questions.

Thanks,
{SENDER_NAME}
{SENDER_EMAIL}`,
        ],
    },
];

async function upsertTemplate(userId, tpl, { forceDefault = false } = {}) {
    const existing = await EmailTemplate.findOne({ user: userId, name: tpl.name });
    if (existing) {
        if (BUILT_IN_TEMPLATE_NAMES.has(tpl.name)) {
            existing.companyName = tpl.companyName || existing.companyName;
            existing.subjectTemplates = tpl.subjectTemplates || existing.subjectTemplates;
            existing.bodyTemplates = tpl.bodyTemplates || existing.bodyTemplates;
        }
        if (forceDefault && tpl.isDefault) {
            await EmailTemplate.updateMany({ user: userId }, { isDefault: false });
            existing.isDefault = true;
        }
        if (existing.isModified()) await existing.save();
        return existing;
    }

    if (tpl.isDefault) {
        await EmailTemplate.updateMany({ user: userId }, { isDefault: false });
    }

    return EmailTemplate.create({ user: userId, ...tpl });
}

async function seedTemplatesForUser(userId) {
    let added = 0;

    for (const tpl of FREIGHT_VARIANT_TEMPLATES) {
        const before = await EmailTemplate.countDocuments({ user: userId, name: tpl.name });
        if (!before) {
            await upsertTemplate(userId, tpl);
            added++;
        }
    }

    const comboExists = await EmailTemplate.findOne({ user: userId, name: FREIGHT_DISPATCH_NAME });
    if (!comboExists) {
        await upsertTemplate(userId, { ...FREIGHT_DISPATCH_TEMPLATE, isDefault: false });
        added++;
    }

    for (const tpl of STARTER_TEMPLATES) {
        const before = await EmailTemplate.countDocuments({ user: userId, name: tpl.name });
        if (!before) {
            await upsertTemplate(userId, tpl);
            added++;
        }
    }

    const hasDefault = await EmailTemplate.exists({ user: userId, isDefault: true });
    if (!hasDefault) {
        const first = await EmailTemplate.findOne({ user: userId, name: 'Freight Outreach 1' })
            || await EmailTemplate.findOne({ user: userId, name: FREIGHT_DISPATCH_NAME });
        if (first) {
            await EmailTemplate.updateMany({ user: userId }, { isDefault: false });
            first.isDefault = true;
            await first.save();
        }
    }

    return added;
}

async function seedTemplatesForAllUsers() {
    try {
        const users = await User.find({}).select('_id');
        let total = 0;
        for (const user of users) {
            total += await seedTemplatesForUser(user._id);
        }
        if (total > 0) {
            console.log(`Seeded ${total} missing email template(s) for ${users.length} user(s)`);
        }
    } catch (err) {
        console.warn('Template seed skipped:', err.message);
    }
}

module.exports = { seedTemplatesForUser, seedTemplatesForAllUsers, upsertTemplate };
