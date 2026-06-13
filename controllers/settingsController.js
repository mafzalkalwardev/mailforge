const { getSettingsForUser, saveSettingsForUser } = require('../utils/settingsService');
const { resetEngineCache } = require('../utils/verificationEngine');

function maskSettings(settings) {
    const out = { ...settings };
    out.hasOpenAiKey = Boolean(out.openaiApiKey);
    if (out.openaiApiKey) out.openaiApiKey = '••••••••';
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
    const settings = await saveSettingsForUser(req.user._id, body);
    resetEngineCache(req.user._id);
    res.json(maskSettings(settings));
};

module.exports = { getSettings, updateSettings };
