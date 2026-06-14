const InboxMessage = require('../models/InboxMessage');
const SenderAccount = require('../models/SenderAccount');
const { syncAllAccounts, syncSenderAccount } = require('../utils/imapSync');
const { sendReplyMessage } = require('../utils/smtpClient');

function parseEmailAddress(raw) {
    const s = String(raw || '').trim();
    const match = s.match(/<([^>]+)>/);
    if (match) return match[1].trim().toLowerCase();
    if (s.includes('@')) return s.toLowerCase();
    return '';
}

function accountFilter(userId, accountId) {
    const filter = { user: userId };
    if (accountId) filter.senderAccount = accountId;
    return filter;
}

function applyInboxFilter(filter, filterType) {
    const f = String(filterType || 'all').toLowerCase();
    if (f === 'unread') filter.isRead = false;
    else if (f === 'starred') filter.isStarred = true;
    else if (f === 'important') filter.isImportant = true;
    return filter;
}

const listMessages = async (req, res) => {
    try {
        const { account, campaign, q, filter, limit = 50, offset = 0 } = req.query;
        const filterQuery = applyInboxFilter(accountFilter(req.user._id, account), filter);
        if (campaign) filterQuery.campaign = campaign;
        if (q) {
            filterQuery.$or = [
                { subject: { $regex: q, $options: 'i' } },
                { from: { $regex: q, $options: 'i' } },
                { bodyPreview: { $regex: q, $options: 'i' } },
            ];
        }

        const [messages, total] = await Promise.all([
            InboxMessage.find(filterQuery)
                .sort({ receivedAt: -1 })
                .skip(Number(offset))
                .limit(Math.min(Number(limit), 100))
                .populate('senderAccount', 'email displayName')
                .populate('campaign', 'name'),
            InboxMessage.countDocuments(filterQuery),
        ]);

        res.json({ messages, total });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching inbox', error: error.message });
    }
};

const getMessage = async (req, res) => {
    try {
        const message = await InboxMessage.findOne({ _id: req.params.id, user: req.user._id })
            .populate('senderAccount', 'email displayName')
            .populate('campaign', 'name');
        if (!message) return res.status(404).json({ message: 'Message not found' });
        res.json(message);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching message', error: error.message });
    }
};

const markRead = async (req, res) => {
    try {
        const message = await InboxMessage.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { isRead: true },
            { new: true }
        );
        if (!message) return res.status(404).json({ message: 'Message not found' });
        res.json(message);
    } catch (error) {
        res.status(500).json({ message: 'Error updating message', error: error.message });
    }
};

const toggleStar = async (req, res) => {
    try {
        const message = await InboxMessage.findOne({ _id: req.params.id, user: req.user._id });
        if (!message) return res.status(404).json({ message: 'Message not found' });
        message.isStarred = !message.isStarred;
        await message.save();
        res.json(message);
    } catch (error) {
        res.status(500).json({ message: 'Error updating star', error: error.message });
    }
};

const toggleImportant = async (req, res) => {
    try {
        const message = await InboxMessage.findOne({ _id: req.params.id, user: req.user._id });
        if (!message) return res.status(404).json({ message: 'Message not found' });
        message.isImportant = !message.isImportant;
        await message.save();
        res.json(message);
    } catch (error) {
        res.status(500).json({ message: 'Error updating important', error: error.message });
    }
};

const syncInbox = async (req, res) => {
    try {
        const { senderAccountId } = req.body || {};
        if (senderAccountId) {
            const account = await SenderAccount.findOne({
                _id: senderAccountId,
                user: req.user._id,
                enabled: true,
            });
            if (!account) {
                return res.status(404).json({ message: 'Sender account not found' });
            }
            const count = await syncSenderAccount(account);
            return res.json({ message: `Synced ${count} new message(s) for ${account.email}`, count });
        }
        await syncAllAccounts();
        res.json({ message: 'Inbox sync completed for all accounts' });
    } catch (error) {
        res.status(500).json({ message: 'Inbox sync failed', error: error.message });
    }
};

const inboxStats = async (req, res) => {
    try {
        const base = accountFilter(req.user._id, req.query.account);
        const [total, unread, starred, important, withCampaign] = await Promise.all([
            InboxMessage.countDocuments(base),
            InboxMessage.countDocuments({ ...base, isRead: false }),
            InboxMessage.countDocuments({ ...base, isStarred: true }),
            InboxMessage.countDocuments({ ...base, isImportant: true }),
            InboxMessage.countDocuments({ ...base, campaign: { $ne: null } }),
        ]);
        res.json({ total, unread, starred, important, campaignReplies: withCampaign });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching inbox stats', error: error.message });
    }
};

const listSenderAccounts = async (req, res) => {
    try {
        const accounts = await SenderAccount.find({ user: req.user._id, enabled: true })
            .sort({ displayName: 1, email: 1 })
            .select('email displayName');
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching sender accounts', error: error.message });
    }
};

const replyToMessage = async (req, res) => {
    try {
        const { body, subject } = req.body;
        if (!body || !String(body).trim()) {
            return res.status(400).json({ message: 'Reply body is required' });
        }

        const message = await InboxMessage.findOne({ _id: req.params.id, user: req.user._id })
            .populate('senderAccount');
        if (!message) return res.status(404).json({ message: 'Message not found' });

        const sender = message.senderAccount;
        if (!sender || !sender.enabled) {
            return res.status(400).json({ message: 'Sender account unavailable for reply' });
        }

        const to = parseEmailAddress(message.from);
        if (!to) return res.status(400).json({ message: 'Could not parse recipient address' });

        const messageId = await sendReplyMessage(sender, {
            to,
            subject: subject || message.subject,
            body: String(body).trim(),
            inReplyTo: message.messageId,
            references: message.messageId,
        });

        res.json({
            message: 'Reply sent',
            to,
            messageId,
            from: sender.email,
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to send reply', error: error.message });
    }
};

module.exports = {
    listMessages,
    getMessage,
    markRead,
    toggleStar,
    toggleImportant,
    syncInbox,
    inboxStats,
    listSenderAccounts,
    replyToMessage,
};
