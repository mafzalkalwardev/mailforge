const SenderAccount = require('../models/SenderAccount');
const { encrypt } = require('../utils/crypto');
const { verifySmtp, sendCampaignMessage } = require('../utils/smtpClient');
const { parseSenderFile } = require('../utils/senderCsvParser');
const fs = require('fs');

const { getWarmupStatus } = require('../utils/warmupService');
const { checkDomainAuth } = require('../utils/dnsAuthCheck');

function sanitizeSender(doc) {
    const obj = doc.toObject ? doc.toObject() : { ...doc };
    delete obj.encryptedPassword;
    obj.warmup = getWarmupStatus(obj);
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

        const {
            email,
            displayName,
            appPassword,
            smtpHost,
            smtpPort,
            imapHost,
            imapPort,
            dailyLimit,
            enabled,
            warmupEnabled,
            warmupDay,
            sentToday,
            resetSentToday,
        } = req.body;

        if (email !== undefined) {
            const nextEmail = String(email).toLowerCase().trim();
            if (!nextEmail || !nextEmail.includes('@')) {
                return res.status(400).json({ message: 'Valid email is required' });
            }
            if (nextEmail !== sender.email) {
                const existing = await SenderAccount.findOne({
                    user: req.user._id,
                    email: nextEmail,
                    _id: { $ne: sender._id },
                });
                if (existing) return res.status(409).json({ message: 'Another sender already uses this email' });
                sender.email = nextEmail;
            }
        }

        if (displayName !== undefined) sender.displayName = displayName;
        if (appPassword) sender.encryptedPassword = encrypt(appPassword);
        if (smtpHost !== undefined) sender.smtpHost = String(smtpHost).trim() || 'smtp.gmail.com';
        if (smtpPort !== undefined) sender.smtpPort = Number(smtpPort) || 465;
        if (imapHost !== undefined) sender.imapHost = String(imapHost).trim() || 'imap.gmail.com';
        if (imapPort !== undefined) sender.imapPort = Number(imapPort) || 993;
        if (dailyLimit !== undefined) sender.dailyLimit = Math.max(1, Number(dailyLimit) || 450);
        if (enabled !== undefined) sender.enabled = enabled;
        if (warmupEnabled !== undefined) sender.warmupEnabled = warmupEnabled;
        if (warmupDay !== undefined) sender.warmupDay = Math.max(1, Number(warmupDay) || 1);
        if (sentToday !== undefined) sender.sentToday = Math.max(0, Number(sentToday) || 0);
        if (resetSentToday === true) {
            sender.sentToday = 0;
            sender.lastSendDate = '';
        }

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

const sendTestEmail = async (req, res) => {
    const { to } = req.body;
    if (!to || !String(to).includes('@')) {
        return res.status(400).json({ message: 'Valid "to" email is required' });
    }

    try {
        const sender = await SenderAccount.findOne({ _id: req.params.id, user: req.user._id });
        if (!sender) return res.status(404).json({ message: 'Sender not found' });

        const name = sender.displayName || sender.email;
        const subject = 'MailForge — test email';
        const body = `This is a test email from MailForge.\n\nSender: ${sender.email}\nTime: ${new Date().toISOString()}\n\nIf you received this, SMTP sending works correctly.`;

        const messageId = await sendCampaignMessage(sender, to.trim(), subject, body);
        res.json({ message: `Test email sent to ${to}`, messageId });
    } catch (error) {
        res.status(400).json({ message: 'Failed to send test email', error: error.message });
    }
};

const bulkImportSenders = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Upload a CSV or XLSX file' });
    }

    const filePath = req.file.path;
    const updateExisting = req.body.updateExisting === 'true' || req.body.updateExisting === true;

    try {
        const parsed = parseSenderFile(filePath, req.file.originalname);
        const results = { added: 0, updated: 0, skipped: 0, errors: [] };

        for (const row of parsed) {
            if (row.error) {
                results.errors.push({ row: row.row, email: row.email, error: row.error });
                results.skipped++;
                continue;
            }

            const existing = await SenderAccount.findOne({
                user: req.user._id,
                email: row.email,
            });

            if (existing) {
                if (updateExisting) {
                    existing.encryptedPassword = encrypt(row.appPassword);
                    if (row.displayName) existing.displayName = row.displayName;
                    existing.enabled = true;
                    await existing.save();
                    results.updated++;
                } else {
                    results.skipped++;
                }
                continue;
            }

            await SenderAccount.create({
                user: req.user._id,
                email: row.email,
                displayName: row.displayName,
                encryptedPassword: encrypt(row.appPassword),
            });
            results.added++;
        }

        res.json(results);
    } catch (error) {
        res.status(400).json({ message: error.message || 'Import failed' });
    } finally {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
};

const checkSenderDns = async (req, res) => {
    try {
        const sender = await SenderAccount.findOne({ _id: req.params.id, user: req.user._id });
        if (!sender) return res.status(404).json({ message: 'Sender not found' });
        const auth = await checkDomainAuth(sender.email);
        sender.dnsAuth = {
            score: auth.score,
            spfOk: auth.spf?.ok,
            dmarcOk: auth.dmarc?.ok,
            dkimOk: auth.dkim?.ok,
            warnings: auth.warnings || [],
            checkedAt: new Date(),
        };
        await sender.save();
        res.json({ ...auth, warmup: getWarmupStatus(sender) });
    } catch (error) {
        res.status(500).json({ message: 'DNS check failed', error: error.message });
    }
};

module.exports = {
    listSenders,
    createSender,
    updateSender,
    deleteSender,
    testSender,
    sendTestEmail,
    bulkImportSenders,
    checkSenderDns,
};
