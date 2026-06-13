const EmailTemplate = require('../models/EmailTemplate');

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

async function ensureDefaultTemplate(userId) {
    const count = await EmailTemplate.countDocuments({ user: userId });
    if (count > 0) return null;
    return EmailTemplate.create({
        user: userId,
        name: 'Default Outreach',
        subjectTemplates: DEFAULT_SUBJECTS,
        bodyTemplates: DEFAULT_BODIES,
        companyName: 'Your Company',
        isDefault: true,
    });
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

module.exports = { listTemplates, createTemplate, updateTemplate, deleteTemplate };
