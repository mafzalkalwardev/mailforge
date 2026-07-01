const InboxMessage = require('../models/InboxMessage');
const SenderAccount = require('../models/SenderAccount');
const Campaign = require('../models/Campaign');
const { syncAllAccounts, syncSenderAccount } = require('../utils/imapSync');
const { sendReplyMessage } = require('../utils/smtpClient');
const { addSuppression } = require('../utils/suppressionService');

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

function addInboxFolderFilter(filter) {
    filter.$and = [
        ...(filter.$and || []),
        { $or: [{ folder: 'inbox' }, { folder: { $exists: false } }] },
    ];
    return filter;
}

function sentMessageId(campaignId, recipientId) {
    return `sent:${campaignId}:${recipientId}`;
}

function toSentMessage(campaign, recipient, senderAccount = null) {
    return {
        _id: sentMessageId(campaign._id, recipient._id),
        folder: 'sent',
        campaign: { _id: campaign._id, name: campaign.name },
        senderAccount,
        from: recipient.senderEmail || '',
        to: recipient.email,
        subject: recipient.subject || '(no subject)',
        bodyPreview: recipient.body ? String(recipient.body).slice(0, 250) : '',
        body: recipient.body || '',
        isRead: true,
        isStarred: false,
        isImportant: false,
        isBounce: false,
        leadTag: 'none',
        messageId: recipient.messageId || '',
        receivedAt: recipient.sentAt || campaign.updatedAt,
        sentAt: recipient.sentAt || campaign.updatedAt,
    };
}

async function listSentMessages(req, res) {
    const { account, campaign, q, limit = 50, offset = 0 } = req.query;
    const sender = account
        ? await SenderAccount.findOne({ _id: account, user: req.user._id }).select('email displayName')
        : null;
    if (account && !sender) return res.json({ messages: [], total: 0, folder: 'sent' });

    const campaigns = await Campaign.find({
        user: req.user._id,
        ...(campaign ? { _id: campaign } : {}),
        'recipients.status': 'sent',
    }).sort({ updatedAt: -1 });

    const needle = String(q || '').trim().toLowerCase();
    const sent = [];

    const sentMessageFilter = { user: req.user._id, folder: 'sent' };
    if (account) sentMessageFilter.senderAccount = account;
    if (campaign) sentMessageFilter.campaign = campaign;
    if (q) {
        sentMessageFilter.$or = [
            { subject: { $regex: q, $options: 'i' } },
            { to: { $regex: q, $options: 'i' } },
            { bodyPreview: { $regex: q, $options: 'i' } },
            { body: { $regex: q, $options: 'i' } },
        ];
    }
    const savedSent = await InboxMessage.find(sentMessageFilter)
        .populate('senderAccount', 'email displayName')
        .populate('campaign', 'name');
    sent.push(...savedSent.map(m => ({ ...m.toObject(), folder: 'sent', sentAt: m.receivedAt })));

    for (const c of campaigns) {
        for (const r of c.recipients || []) {
            if (r.status !== 'sent') continue;
            if (sender && String(r.senderEmail || '').toLowerCase() !== sender.email.toLowerCase()) continue;
            if (needle) {
                const haystack = `${r.email || ''} ${r.senderEmail || ''} ${r.subject || ''} ${r.body || ''}`.toLowerCase();
                if (!haystack.includes(needle)) continue;
            }
            sent.push(toSentMessage(c, r, sender || null));
        }
    }

    sent.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const start = Math.max(Number(offset) || 0, 0);
    const end = start + Math.min(Number(limit) || 50, 100);
    res.json({ messages: sent.slice(start, end), total: sent.length, folder: 'sent' });
}

async function getSentMessage(req, res) {
    const [, campaignId, recipientId] = String(req.params.id || '').split(':');
    if (!campaignId || !recipientId) return res.status(404).json({ message: 'Message not found' });

    const campaign = await Campaign.findOne({ _id: campaignId, user: req.user._id });
    if (!campaign) return res.status(404).json({ message: 'Message not found' });

    const recipient = campaign.recipients.id(recipientId);
    if (!recipient || recipient.status !== 'sent') return res.status(404).json({ message: 'Message not found' });

    const sender = recipient.senderEmail
        ? await SenderAccount.findOne({ user: req.user._id, email: recipient.senderEmail }).select('email displayName')
        : null;
    res.json(toSentMessage(campaign, recipient, sender));
}

const listMessages = async (req, res) => {
    try {
        const { account, campaign, q, filter, threads, limit = 50, offset = 0 } = req.query;
        if (String(filter || '').toLowerCase() === 'sent') return listSentMessages(req, res);

        const filterQuery = applyInboxFilter(accountFilter(req.user._id, account), filter);
        addInboxFolderFilter(filterQuery);
        if (campaign) filterQuery.campaign = campaign;
        if (q) {
            filterQuery.$or = [
                { subject: { $regex: q, $options: 'i' } },
                { from: { $regex: q, $options: 'i' } },
                { bodyPreview: { $regex: q, $options: 'i' } },
            ];
        }

        if (threads === '1') {
            const pipeline = [
                { $match: filterQuery },
                { $sort: { receivedAt: -1 } },
                {
                    $group: {
                        _id: { $ifNull: ['$threadKey', '$messageId'] },
                        latestId: { $first: '$_id' },
                        count: { $sum: 1 },
                        latestAt: { $first: '$receivedAt' },
                        subject: { $first: '$subject' },
                        from: { $first: '$from' },
                        isRead: { $first: '$isRead' },
                        isStarred: { $first: '$isStarred' },
                        campaign: { $first: '$campaign' },
                        senderAccount: { $first: '$senderAccount' },
                    },
                },
                { $sort: { latestAt: -1 } },
                { $skip: Number(offset) },
                { $limit: Math.min(Number(limit), 100) },
            ];
            const threadsList = await InboxMessage.aggregate(pipeline);
            const ids = threadsList.map(t => t.latestId);
            const messages = await InboxMessage.find({ _id: { $in: ids } })
                .populate('senderAccount', 'email displayName')
                .populate('campaign', 'name');
            const countMap = Object.fromEntries(threadsList.map(t => [String(t.latestId), t.count]));
            return res.json({
                messages: messages.map(m => ({ ...m.toObject(), threadCount: countMap[String(m._id)] || 1 })),
                total: threadsList.length,
                threaded: true,
            });
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
        if (String(req.params.id || '').startsWith('sent:')) return getSentMessage(req, res);

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
            { returnDocument: 'after' }
        );
        if (!message) return res.status(404).json({ message: 'Message not found' });
        res.json(message);
    } catch (error) {
        res.status(500).json({ message: 'Error updating message', error: error.message });
    }
};

const markAllRead = async (req, res) => {
    try {
        const filter = accountFilter(req.user._id, req.body?.senderAccountId || req.query.account);
        const result = await InboxMessage.updateMany(
            addInboxFolderFilter({ ...filter, isRead: false }),
            { $set: { isRead: true } }
        );
        res.json({ message: `Marked ${result.modifiedCount || 0} message(s) as read`, modifiedCount: result.modifiedCount || 0 });
    } catch (error) {
        res.status(500).json({ message: 'Error marking messages read', error: error.message });
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
            return res.json({
                message: `Synced ${count.inbox} inbox and ${count.sent} sent new message(s) for ${account.email}`,
                count: count.total,
                inbox: count.inbox,
                sent: count.sent,
            });
        }
        await syncAllAccounts();
        res.json({ message: 'Inbox sync completed for all accounts' });
    } catch (error) {
        res.status(500).json({ message: 'Inbox sync failed', error: error.message });
    }
};

const inboxStats = async (req, res) => {
    try {
        const base = addInboxFolderFilter(accountFilter(req.user._id, req.query.account));
        let sentFilter = { user: req.user._id, 'recipients.status': 'sent' };
        if (req.query.account) {
            const sender = await SenderAccount.findOne({ _id: req.query.account, user: req.user._id }).select('email');
            sentFilter = sender ? { ...sentFilter, 'recipients.senderEmail': sender.email } : null;
        }
        const [total, unread, starred, important, withCampaign] = await Promise.all([
            InboxMessage.countDocuments(base),
            InboxMessage.countDocuments({ ...base, isRead: false }),
            InboxMessage.countDocuments({ ...base, isStarred: true }),
            InboxMessage.countDocuments({ ...base, isImportant: true }),
            InboxMessage.countDocuments({ ...base, campaign: { $ne: null } }),
        ]);
        const sentAgg = sentFilter
            ? await Campaign.aggregate([
                { $match: sentFilter },
                { $unwind: '$recipients' },
                { $match: {
                    'recipients.status': 'sent',
                    ...(sentFilter['recipients.senderEmail'] ? { 'recipients.senderEmail': sentFilter['recipients.senderEmail'] } : {}),
                } },
                { $count: 'total' },
            ])
            : [];
        const savedSentBase = accountFilter(req.user._id, req.query.account);
        const savedSent = await InboxMessage.countDocuments({ ...savedSentBase, folder: 'sent' });
        const sent = (sentAgg[0]?.total || 0) + savedSent;
        res.json({ total, unread, starred, important, campaignReplies: withCampaign, sent });
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

        await InboxMessage.create({
            user: req.user._id,
            senderAccount: sender._id,
            campaign: message.campaign || undefined,
            folder: 'sent',
            uid: `sent-reply-${message._id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            messageId,
            inReplyTo: message.messageId,
            from: sender.email,
            to,
            subject: subject || message.subject,
            bodyPreview: String(body).trim().slice(0, 250),
            body: String(body).trim(),
            isRead: true,
            threadKey: message.threadKey || message.messageId || '',
            receivedAt: new Date(),
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

const setLeadTag = async (req, res) => {
    try {
        const { tag } = req.body;
        const allowed = ['none', 'lead', 'not_interested', 'follow_up'];
        if (!allowed.includes(tag)) return res.status(400).json({ message: 'Invalid tag' });
        const message = await InboxMessage.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { leadTag: tag },
            { returnDocument: 'after' }
        );
        if (!message) return res.status(404).json({ message: 'Message not found' });
        if (tag === 'not_interested') {
            const email = parseEmailAddress(message.from);
            if (email) await addSuppression(req.user._id, email, 'manual', 'Marked not interested in inbox');
        }
        res.json(message);
    } catch (error) {
        res.status(500).json({ message: 'Error updating lead tag', error: error.message });
    }
};

module.exports = {
    listMessages,
    getMessage,
    markRead,
    markAllRead,
    toggleStar,
    toggleImportant,
    syncInbox,
    inboxStats,
    listSenderAccounts,
    replyToMessage,
    setLeadTag,
};
