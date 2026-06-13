const { getSettingsForUser, saveSettingsForUser } = require('../utils/settingsService');
const { resetEngineCache } = require('../utils/verificationEngine');

function maskSettings(settings) {
    const out = { ...settings };
    out.hasOpenAiKey = Boolean(out.openaiApiKey);
    out.hasGroqKey = Boolean(out.groqApiKey);
    out.hasOpenRouterKey = Boolean(out.openrouterApiKey);
    if (out.openaiApiKey) out.openaiApiKey = '••••••••';
    if (out.groqApiKey) out.groqApiKey = '••••••••';
    if (out.openrouterApiKey) out.openrouterApiKey = '••••••••';
    return out;
}

const getSettings = async (req, res) => {
    const settings = await getSettingsForUser(req.user._id);
    res.json(maskSettings(settings));
};

const updateSettings = async (req, res) => {
    const existing = await getSettingsForUser(req.user._id);
    const body = { ...req.body };
    if (body.openaiApiKey === '••••••••' || body.openaiApiKey === '') {
        body.openaiApiKey = existing.openaiApiKey || '';
    }
    if (body.groqApiKey === '••••••••' || body.groqApiKey === '') {
        body.groqApiKey = existing.groqApiKey || '';
    }
    if (body.openrouterApiKey === '••••••••' || body.openrouterApiKey === '') {
        body.openrouterApiKey = existing.openrouterApiKey || '';
    }
    const settings = await saveSettingsForUser(req.user._id, body);
    resetEngineCache(req.user._id);
    res.json(maskSettings(settings));
};

module.exports = { getSettings, updateSettings };
