const SenderAccount = require('../models/SenderAccount');
const Campaign = require('../models/Campaign');
const BulkJob = require('../models/BulkJob');
const InboxMessage = require('../models/InboxMessage');
const SuppressedEmail = require('../models/SuppressedEmail');
const VerifyJob = require('../models/VerifyJob');
const ValidationHistory = require('../models/ValidationHistory');

const getOverview = async (req, res) => {
    try {
        const userId = req.user._id;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [
            senders,
            campaigns,
            bulkJobs,
            inboxUnread,
            suppressedCount,
            activeVerifyJob,
            historyAgg,
        ] = await Promise.all([
            SenderAccount.find({ user: userId }).select('email displayName dailyLimit enabled lastSyncAt'),
            Campaign.find({ user: userId }).select('name status stats createdAt scheduledAt'),
            BulkJob.countDocuments({ user: userId }),
            InboxMessage.countDocuments({ user: userId, isRead: false }),
            SuppressedEmail.countDocuments({ user: userId }),
            VerifyJob.findOne({ user: userId, status: { $in: ['running', 'paused'] } })
                .sort({ updatedAt: -1 })
                .select('status progress fileName updatedAt'),
            ValidationHistory.aggregate([
                { $match: { user: userId } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        valid: { $sum: { $cond: [{ $eq: ['$valid', true] }, 1, 0] } },
                        invalid: { $sum: { $cond: [{ $eq: ['$valid', false] }, 1, 0] } },
                    },
                },
            ]),
        ]);

        const runningCampaigns = campaigns.filter(c => c.status === 'running');
        const scheduledCampaigns = campaigns.filter(c => c.status === 'scheduled');

        const senderHealth = await Promise.all(
            senders.map(async s => {
                const sentToday = await Campaign.aggregate([
                    { $match: { user: userId } },
                    { $unwind: '$recipients' },
                    {
                        $match: {
                            'recipients.senderEmail': s.email,
                            'recipients.status': 'sent',
                            'recipients.sentAt': { $gte: todayStart },
                        },
                    },
                    { $count: 'count' },
                ]);
                const count = sentToday[0]?.count || 0;
                return {
                    id: s._id,
                    email: s.email,
                    displayName: s.displayName,
                    enabled: s.enabled,
                    dailyLimit: s.dailyLimit,
                    sentToday: count,
                    remaining: Math.max(0, (s.dailyLimit || 450) - count),
                    lastSyncAt: s.lastSyncAt,
                };
            })
        );

        const stats = historyAgg[0] || { total: 0, valid: 0, invalid: 0 };

        const onboarding = {
            hasSenders: senders.length > 0,
            hasVerifiedList: bulkJobs > 0,
            hasCampaign: campaigns.length > 0,
            hasInboxActivity: inboxUnread > 0 || (await InboxMessage.countDocuments({ user: userId })) > 0,
            completedSteps: 0,
        };
        onboarding.completedSteps = [
            onboarding.hasSenders,
            onboarding.hasVerifiedList,
            onboarding.hasCampaign,
            onboarding.hasInboxActivity,
        ].filter(Boolean).length;

        res.json({
            stats: {
                total: stats.total,
                valid: stats.valid,
                invalid: stats.invalid,
                unknown: Math.max(0, stats.total - stats.valid - stats.invalid),
            },
            senders: senderHealth,
            campaigns: {
                total: campaigns.length,
                running: runningCampaigns.length,
                scheduled: scheduledCampaigns.length,
                recent: campaigns.slice(0, 5).map(c => ({
                    id: c._id,
                    name: c.name,
                    status: c.status,
                    stats: c.stats,
                    scheduledAt: c.scheduledAt,
                })),
            },
            inbox: { unread: inboxUnread },
            suppression: { total: suppressedCount },
            activeVerifyJob,
            onboarding,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error loading dashboard', error: error.message });
    }
};

module.exports = { getOverview };
