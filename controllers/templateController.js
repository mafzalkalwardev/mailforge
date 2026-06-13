const EmailTemplate = require('../models/EmailTemplate');
const { getSettingsForUser } = require('../utils/settingsService');
const { generateEmailTemplates } = require('../utils/aiTemplateService');
const { FREIGHT_DISPATCH_NAME, FREIGHT_DISPATCH_TEMPLATE } = require('../utils/freightDispatchTemplates');

const DEFAULT_SUBJECTS = [
    'Quick introduction — {COMPANY_NAME}',
    'Following up — opportunity for {Name}',
    'Let\'s connect — {COMPANY_NAME}',
];

const DEFAULT_BODIES = [
    `Hi {Name},

I hope this message finds you well. My name is {SENDER_NAME} from {COMPANY_NAME}, and I'd like to connect with you.

Please let me know if you're interested in learning more.

Best regards,
{SENDER_NAME}
{COMPANY_NAME}
{SENDER_EMAIL}`,
];

const STARTER_TEMPLATES = [
    { ...FREIGHT_DISPATCH_TEMPLATE, isDefault: true },
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

async function ensureFreightDispatchTemplate(userId) {
    const existing = await EmailTemplate.findOne({ user: userId, name: FREIGHT_DISPATCH_NAME });
    if (existing) return existing;

    const hasDefault = await EmailTemplate.exists({ user: userId, isDefault: true });
    return EmailTemplate.create({
        user: userId,
        ...FREIGHT_DISPATCH_TEMPLATE,
        isDefault: !hasDefault,
    });
}

async function ensureDefaultTemplate(userId) {
    await ensureFreightDispatchTemplate(userId);

    const count = await EmailTemplate.countDocuments({ user: userId });
    if (count > 1) return null;

    const created = [];
    for (const tpl of STARTER_TEMPLATES) {
        const exists = await EmailTemplate.findOne({ user: userId, name: tpl.name });
        if (exists) continue;
        created.push(await EmailTemplate.create({ user: userId, ...tpl }));
    }
    return created;
}

const listTemplates = async (req, res) => {
    try {
        await ensureDefaultTemplate(req.user._id);
        const templates = await EmailTemplate.find({ user: req.user._id }).sort({ createdAt: -1 });
        res.json(templates);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching templates', error: error.message });
    }
};

const createTemplate = async (req, res) => {
    const { name, subjectTemplates, bodyTemplates, companyName, isDefault } = req.body;
    if (!name || !subjectTemplates?.length || !bodyTemplates?.length) {
        return res.status(400).json({ message: 'name, subjectTemplates, and bodyTemplates are required' });
    }

    try {
        if (isDefault) {
            await EmailTemplate.updateMany({ user: req.user._id }, { isDefault: false });
        }
        const template = await EmailTemplate.create({
            user: req.user._id,
            name,
            subjectTemplates,
            bodyTemplates,
            companyName: companyName || '',
            isDefault: Boolean(isDefault),
        });
        res.status(201).json(template);
    } catch (error) {
        res.status(500).json({ message: 'Error creating template', error: error.message });
    }
};

const updateTemplate = async (req, res) => {
    try {
        const template = await EmailTemplate.findOne({ _id: req.params.id, user: req.user._id });
        if (!template) return res.status(404).json({ message: 'Template not found' });

        const { name, subjectTemplates, bodyTemplates, companyName, isDefault } = req.body;
        if (name) template.name = name;
        if (subjectTemplates) template.subjectTemplates = subjectTemplates;
        if (bodyTemplates) template.bodyTemplates = bodyTemplates;
        if (companyName !== undefined) template.companyName = companyName;
        if (isDefault) {
            await EmailTemplate.updateMany({ user: req.user._id }, { isDefault: false });
            template.isDefault = true;
        }

        await template.save();
        res.json(template);
    } catch (error) {
        res.status(500).json({ message: 'Error updating template', error: error.message });
    }
};

const deleteTemplate = async (req, res) => {
    try {
        const template = await EmailTemplate.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        if (!template) return res.status(404).json({ message: 'Template not found' });
        res.json({ message: 'Template deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting template', error: error.message });
    }
};

const generateTemplate = async (req, res) => {
    const { companyName, industry, goal, tone, count, saveAsDefault } = req.body;

    try {
        const settings = await getSettingsForUser(req.user._id);
        const generated = await generateEmailTemplates(settings, {
            companyName,
            industry,
            goal,
            tone,
            count: Math.min(parseInt(count, 10) || 3, 5),
        });

        const template = await EmailTemplate.create({
            user: req.user._id,
            name: generated.name,
            subjectTemplates: generated.subjectTemplates,
            bodyTemplates: generated.bodyTemplates,
            companyName: generated.companyName || companyName || '',
            isDefault: Boolean(saveAsDefault),
        });

        if (saveAsDefault) {
            await EmailTemplate.updateMany(
                { user: req.user._id, _id: { $ne: template._id } },
                { isDefault: false }
            );
        }

        res.status(201).json(template);
    } catch (error) {
        const status = error.message.includes('API key') ? 400 : 502;
        res.status(status).json({ message: error.message || 'AI generation failed' });
    }
};

module.exports = { listTemplates, createTemplate, updateTemplate, deleteTemplate, generateTemplate };
