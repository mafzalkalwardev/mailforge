const SenderAccount = require('../models/SenderAccount');
const { encrypt } = require('../utils/crypto');
const { verifySmtp } = require('../utils/smtpClient');

function sanitizeSender(doc) {
    const obj = doc.toObject ? doc.toObject() : { ...doc };
    delete obj.encryptedPassword;
    return obj;
}

const listSenders = async (req, res) => {
    try {
        const senders = await SenderAccount.find({ user: req.user._id }).sort({ createdAt: -1 });
        res.json(senders.map(sanitizeSender));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching senders', error: error.message });
    }
};

const createSender = async (req, res) => {
    const { email, displayName, appPassword, smtpHost, smtpPort, imapHost, imapPort, dailyLimit } = req.body;
    if (!email || !appPassword) {
        return res.status(400).json({ message: 'email and appPassword are required' });
    }

    try {
        const existing = await SenderAccount.findOne({ user: req.user._id, email: email.toLowerCase().trim() });
        if (existing) {
            return res.status(409).json({ message: 'Sender account already exists' });
        }

        const sender = await SenderAccount.create({
            user: req.user._id,
            email: email.toLowerCase().trim(),
            displayName: displayName || email.split('@')[0],
            encryptedPassword: encrypt(appPassword),
            smtpHost: smtpHost || 'smtp.gmail.com',
            smtpPort: smtpPort || 465,
            imapHost: imapHost || 'imap.gmail.com',
            imapPort: imapPort || 993,
            dailyLimit: dailyLimit || 450,
        });

        res.status(201).json(sanitizeSender(sender));
    } catch (error) {
        res.status(500).json({ message: 'Error creating sender', error: error.message });
    }
};

const updateSender = async (req, res) => {
    try {
        const sender = await SenderAccount.findOne({ _id: req.params.id, user: req.user._id });
        if (!sender) return res.status(404).json({ message: 'Sender not found' });

        const { displayName, appPassword, smtpHost, smtpPort, imapHost, imapPort, dailyLimit, enabled } = req.body;
        if (displayName !== undefined) sender.displayName = displayName;
        if (appPassword) sender.encryptedPassword = encrypt(appPassword);
        if (smtpHost) sender.smtpHost = smtpHost;
        if (smtpPort) sender.smtpPort = smtpPort;
        if (imapHost) sender.imapHost = imapHost;
        if (imapPort) sender.imapPort = imapPort;
        if (dailyLimit) sender.dailyLimit = dailyLimit;
        if (enabled !== undefined) sender.enabled = enabled;

        await sender.save();
        res.json(sanitizeSender(sender));
    } catch (error) {
        res.status(500).json({ message: 'Error updating sender', error: error.message });
    }
};

const deleteSender = async (req, res) => {
    try {
        const sender = await SenderAccount.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        if (!sender) return res.status(404).json({ message: 'Sender not found' });
        res.json({ message: 'Sender deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting sender', error: error.message });
    }
};

const testSender = async (req, res) => {
    try {
        const sender = await SenderAccount.findOne({ _id: req.params.id, user: req.user._id });
        if (!sender) return res.status(404).json({ message: 'Sender not found' });
        await verifySmtp(sender);
        res.json({ message: 'SMTP connection successful' });
    } catch (error) {
        res.status(400).json({ message: 'SMTP test failed', error: error.message });
    }
};

module.exports = { listSenders, createSender, updateSender, deleteSender, testSender };
