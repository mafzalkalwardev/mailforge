const EmailTemplate = require('../models/EmailTemplate');
const { getSettingsForUser } = require('../utils/settingsService');
const { generateEmailTemplates } = require('../utils/aiTemplateService');
const { seedTemplatesForUser } = require('../utils/seedTemplates');

const listTemplates = async (req, res) => {
    try {
        await seedTemplatesForUser(req.user._id);
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
