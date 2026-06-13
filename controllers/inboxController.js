const InboxMessage = require('../models/InboxMessage');
const { syncAllAccounts } = require('../utils/imapSync');

const listMessages = async (req, res) => {
    try {
        const { account, campaign, q, limit = 50, offset = 0 } = req.query;
        const filter = { user: req.user._id };
        if (account) filter.senderAccount = account;
        if (campaign) filter.campaign = campaign;
        if (q) {
            filter.$or = [
                { subject: { $regex: q, $options: 'i' } },
                { from: { $regex: q, $options: 'i' } },
                { bodyPreview: { $regex: q, $options: 'i' } },
            ];
        }

        const [messages, total] = await Promise.all([
            InboxMessage.find(filter)
                .sort({ receivedAt: -1 })
                .skip(Number(offset))
                .limit(Math.min(Number(limit), 100))
                .populate('senderAccount', 'email displayName')
                .populate('campaign', 'name'),
            InboxMessage.countDocuments(filter),
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

const syncInbox = async (req, res) => {
    try {
        await syncAllAccounts();
        res.json({ message: 'Inbox sync completed' });
    } catch (error) {
        res.status(500).json({ message: 'Inbox sync failed', error: error.message });
    }
};

const inboxStats = async (req, res) => {
    try {
        const [total, unread, withCampaign] = await Promise.all([
            InboxMessage.countDocuments({ user: req.user._id }),
            InboxMessage.countDocuments({ user: req.user._id, isRead: false }),
            InboxMessage.countDocuments({ user: req.user._id, campaign: { $ne: null } }),
        ]);
        res.json({ total, unread, campaignReplies: withCampaign });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching inbox stats', error: error.message });
    }
};

module.exports = { listMessages, getMessage, markRead, syncInbox, inboxStats };
