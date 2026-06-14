const BulkJob = require('../models/BulkJob');
const Campaign = require('../models/Campaign');
const EmailTemplate = require('../models/EmailTemplate');
const SenderAccount = require('../models/SenderAccount');
const InboxMessage = require('../models/InboxMessage');
const { isSuppressed, addSuppression } = require('../utils/suppressionService');
const { startCampaign, pauseCampaign, isCampaignRunning, recomputeStats } = require('../utils/campaignWorker');
const { checkSendersDns } = require('../utils/dnsAuthCheck');

function rowToRecipient(row, validOnly, headers) {
    const email = String(row.email || '').toLowerCase().trim();
    if (!email) return null;
    if (validOnly && !row.valid) return null;

    const rowData = {};
    if (Array.isArray(headers) && headers.length && Array.isArray(row.originalRow)) {
        headers.forEach((header, idx) => {
            const key = String(header || '').trim();
            if (key) rowData[key] = row.originalRow[idx] ?? '';
        });
    } else if (row.originalRow && typeof row.originalRow === 'object' && !Array.isArray(row.originalRow)) {
        Object.assign(rowData, row.originalRow);
    }
    rowData.Email = email;
    if (!rowData.Name) rowData.Name = rowData.name || '';

    return { email, rowData, status: 'pending' };
}

const listCampaigns = async (req, res) => {
    try {
        const campaigns = await Campaign.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .select('-recipients');
        res.json(campaigns);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching campaigns', error: error.message });
    }
};

const getCampaign = async (req, res) => {
    try {
        const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user._id });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        res.json(campaign);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching campaign', error: error.message });
    }
};

const createFromBulkJob = async (req, res) => {
    const {
        bulkJobId,
        name,
        templateId,
        senderAccountIds,
        validOnly = true,
        dedupe = false,
        companyName,
        subjectTemplates,
        bodyTemplates,
        settings,
        scheduledAt,
    } = req.body;

    if (!bulkJobId || !name) {
        return res.status(400).json({ message: 'bulkJobId and name are required' });
    }

    try {
        const job = await BulkJob.findOne({ _id: bulkJobId, user: req.user._id });
        if (!job) return res.status(404).json({ message: 'Bulk job not found' });

        let template = null;
        if (templateId) {
            template = await EmailTemplate.findOne({ _id: templateId, user: req.user._id });
        } else {
            template = await EmailTemplate.findOne({ user: req.user._id, isDefault: true });
        }

        const senderIds = senderAccountIds?.length
            ? senderAccountIds
            : (await SenderAccount.find({ user: req.user._id, enabled: true })).map(s => s._id);

        if (!senderIds.length) {
            return res.status(400).json({ message: 'Add at least one sender account first' });
        }

        let rowList = [];
        for (const row of job.rows || []) {
            const rec = rowToRecipient(row, validOnly, job.headers);
            if (rec) rowList.push(rec);
        }
        if (dedupe) {
            const seen = new Set();
            rowList = rowList.filter(r => {
                const e = String(r.email).toLowerCase();
                if (seen.has(e)) return false;
                seen.add(e);
                return true;
            });
        }

        const recipients = [];
        for (const rec of rowList) {
            if (await isSuppressed(req.user._id, rec.email)) continue;
            recipients.push(rec);
        }

        if (!recipients.length) {
            return res.status(400).json({ message: 'No valid recipients in bulk job (after suppression filter)' });
        }

        const campaign = await Campaign.create({
            user: req.user._id,
            name,
            bulkJobId: job._id,
            templateId: template?._id,
            companyName: companyName || template?.companyName || '',
            subjectTemplates: subjectTemplates?.length ? subjectTemplates : template?.subjectTemplates || [],
            bodyTemplates: bodyTemplates?.length ? bodyTemplates : template?.bodyTemplates || [],
            senderAccountIds: senderIds,
            validOnly,
            settings: {
                minDelayMs: settings?.minDelayMs ?? 5000,
                maxDelayMs: settings?.maxDelayMs ?? 15000,
                retries: settings?.retries ?? 2,
                maxPerSender: settings?.maxPerSender ?? 450,
                warmUp: settings?.warmUp !== false,
                appendUnsubscribe: settings?.appendUnsubscribe !== false,
            },
            recipients,
            status: scheduledAt && new Date(scheduledAt) > new Date() ? 'scheduled' : 'draft',
            scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        });

        recomputeStats(campaign);
        await campaign.save();

        res.status(201).json(campaign);
    } catch (error) {
        res.status(500).json({ message: 'Error creating campaign', error: error.message });
    }
};

const updateCampaign = async (req, res) => {
    try {
        const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user._id });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        if (campaign.status === 'running') {
            return res.status(400).json({ message: 'Pause campaign before editing' });
        }

        const { name, companyName, subjectTemplates, bodyTemplates, senderAccountIds, settings } = req.body;
        if (name) campaign.name = name;
        if (companyName !== undefined) campaign.companyName = companyName;
        if (subjectTemplates) campaign.subjectTemplates = subjectTemplates;
        if (bodyTemplates) campaign.bodyTemplates = bodyTemplates;
        if (senderAccountIds) campaign.senderAccountIds = senderAccountIds;
        if (settings) campaign.settings = { ...campaign.settings, ...settings };

        await campaign.save();
        res.json(campaign);
    } catch (error) {
        res.status(500).json({ message: 'Error updating campaign', error: error.message });
    }
};

const startCampaignHandler = async (req, res) => {
    try {
        const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user._id });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        if (isCampaignRunning(campaign._id)) {
            return res.status(400).json({ message: 'Campaign is already running' });
        }

        const { scheduledAt, skipDnsCheck } = req.body || {};
        if (scheduledAt) campaign.scheduledAt = new Date(scheduledAt);

        if (campaign.scheduledAt && campaign.scheduledAt > new Date()) {
            campaign.status = 'scheduled';
            await campaign.save();
            return res.json({
                message: `Campaign scheduled for ${campaign.scheduledAt.toISOString()}`,
                id: campaign._id,
                status: 'scheduled',
                scheduledAt: campaign.scheduledAt,
            });
        }

        if (!['draft', 'paused', 'scheduled'].includes(campaign.status)) {
            return res.status(400).json({ message: `Cannot start campaign in status: ${campaign.status}` });
        }

        const senders = await SenderAccount.find({
            _id: { $in: campaign.senderAccountIds },
            user: req.user._id,
            enabled: true,
        });
        if (!senders.length) {
            return res.status(400).json({ message: 'No enabled sender accounts' });
        }

        let dnsWarnings = [];
        if (!skipDnsCheck) {
            const dnsResults = await checkSendersDns(senders);
            for (let i = 0; i < senders.length; i++) {
                const r = dnsResults[i];
                senders[i].dnsAuth = {
                    score: r.score,
                    spfOk: r.spf?.ok,
                    dmarcOk: r.dmarc?.ok,
                    dkimOk: r.dkim?.ok,
                    warnings: r.warnings || [],
                    checkedAt: new Date(),
                };
                await senders[i].save();
            }
            dnsWarnings = dnsResults.flatMap(r => (r.warnings || []).map(w => `${r.email}: ${w}`));
            const weak = dnsResults.filter(r => r.score < 2);
            if (weak.length && req.body?.requireDnsPass) {
                return res.status(400).json({
                    message: 'DNS authentication check failed for one or more senders',
                    dnsResults: weak,
                });
            }
        }

        campaign.status = 'running';
        campaign.startedAt = campaign.startedAt || new Date();
        campaign.lastError = '';
        campaign.scheduledAt = undefined;
        await campaign.save();

        startCampaign(campaign._id);
        res.json({
            message: 'Campaign started',
            id: campaign._id,
            status: 'running',
            dnsWarnings,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error starting campaign', error: error.message });
    }
};

const pauseCampaignHandler = async (req, res) => {
    try {
        const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user._id });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        pauseCampaign(campaign._id);
        campaign.status = 'paused';
        await campaign.save();
        res.json({ message: 'Campaign paused', status: 'paused' });
    } catch (error) {
        res.status(500).json({ message: 'Error pausing campaign', error: error.message });
    }
};

const getCampaignAnalytics = async (req, res) => {
    try {
        const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user._id });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        const replyCount = await InboxMessage.countDocuments({
            user: req.user._id,
            campaign: campaign._id,
        });

        campaign.stats.replies = replyCount;
        await campaign.save();

        const sent = campaign.stats?.sent || 0;
        const replyRate = sent > 0 ? Math.round((replyCount / sent) * 1000) / 10 : 0;

        const repliesByDay = await InboxMessage.aggregate([
            { $match: { user: req.user._id, campaign: campaign._id } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$receivedAt' } },
                    count: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        const repliesBySender = await InboxMessage.aggregate([
            { $match: { user: req.user._id, campaign: campaign._id } },
            { $group: { _id: '$senderAccount', count: { $sum: 1 } } },
        ]);

        const senderIds = repliesBySender.map(r => r._id).filter(Boolean);
        const senders = await SenderAccount.find({ _id: { $in: senderIds } }).select('email displayName');
        const senderMap = Object.fromEntries(senders.map(s => [String(s._id), s]));

        const sendsBySender = {};
        for (const r of campaign.recipients || []) {
            if (r.status !== 'sent' || !r.senderEmail) continue;
            sendsBySender[r.senderEmail] = (sendsBySender[r.senderEmail] || 0) + 1;
        }

        res.json({
            stats: { ...campaign.stats, replies: replyCount, replyRate },
            repliesByDay: repliesByDay.map(r => ({ date: r._id, count: r.count })),
            repliesBySender: repliesBySender.map(r => ({
                sender: senderMap[String(r._id)] || { email: 'Unknown' },
                replies: r.count,
                sent: sendsBySender[senderMap[String(r._id)]?.email] || 0,
            })),
            timeline: {
                startedAt: campaign.startedAt,
                completedAt: campaign.completedAt,
                scheduledAt: campaign.scheduledAt,
            },
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching analytics', error: error.message });
    }
};

const getCampaignQueue = async (req, res) => {
    try {
        const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user._id });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

        const stats = campaign.stats || {};
        const total = stats.total || 0;
        const done = (stats.sent || 0) + (stats.failed || 0) + (stats.skipped || 0);
        const progress = total > 0 ? Math.round((done / total) * 1000) / 10 : 0;

        const failed = (campaign.recipients || [])
            .filter(r => r.status === 'failed')
            .slice(0, 100)
            .map(r => ({ id: r._id, email: r.email, error: r.error, senderEmail: r.senderEmail }));

        const recent = (campaign.recipients || [])
            .filter(r => r.sentAt)
            .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
            .slice(0, 20)
            .map(r => ({ email: r.email, status: r.status, sentAt: r.sentAt, senderEmail: r.senderEmail }));

        res.json({
            status: campaign.status,
            running: isCampaignRunning(campaign._id),
            progress,
            stats,
            lastError: campaign.lastError || '',
            failed,
            recent,
            startedAt: campaign.startedAt,
            completedAt: campaign.completedAt,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching queue', error: error.message });
    }
};

const retryFailedRecipients = async (req, res) => {
    try {
        const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user._id });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        if (isCampaignRunning(campaign._id)) {
            return res.status(400).json({ message: 'Campaign is still running' });
        }

        const ids = Array.isArray(req.body?.recipientIds) ? req.body.recipientIds.map(String) : null;
        let retried = 0;

        for (const r of campaign.recipients || []) {
            if (r.status !== 'failed') continue;
            if (ids && !ids.includes(String(r._id))) continue;
            r.status = 'pending';
            r.error = '';
            retried += 1;
        }

        if (!retried) {
            return res.status(400).json({ message: 'No failed recipients to retry' });
        }

        recomputeStats(campaign);
        campaign.status = 'running';
        campaign.lastError = '';
        await campaign.save();
        startCampaign(campaign._id);

        res.json({ message: `Retrying ${retried} failed recipient(s)`, retried, status: 'running' });
    } catch (error) {
        res.status(500).json({ message: 'Error retrying failed sends', error: error.message });
    }
};

const deleteCampaign = async (req, res) => {
    try {
        const campaign = await Campaign.findOne({ _id: req.params.id, user: req.user._id });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        if (campaign.status === 'running') {
            pauseCampaign(campaign._id);
        }
        await campaign.deleteOne();
        res.json({ message: 'Campaign deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting campaign', error: error.message });
    }
};

module.exports = {
    listCampaigns,
    getCampaign,
    createFromBulkJob,
    updateCampaign,
    startCampaignHandler,
    pauseCampaignHandler,
    deleteCampaign,
    getCampaignAnalytics,
    getCampaignQueue,
    retryFailedRecipients,
};
