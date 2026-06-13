const { getSettingsForUser, saveSettingsForUser } = require('../utils/settingsService');
const { resetEngineCache } = require('../utils/verificationEngine');

const getSettings = async (req, res) => {
    const settings = await getSettingsForUser(req.user._id);
    res.json(settings);
};

const updateSettings = async (req, res) => {
    const settings = await saveSettingsForUser(req.user._id, req.body);
    resetEngineCache(req.user._id);
    res.json(settings);
};

module.exports = { getSettings, updateSettings };
