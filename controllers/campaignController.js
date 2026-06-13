const BulkJob = require('../models/BulkJob');
const Campaign = require('../models/Campaign');
const EmailTemplate = require('../models/EmailTemplate');
const SenderAccount = require('../models/SenderAccount');
const { startCampaign, pauseCampaign, isCampaignRunning, recomputeStats } = require('../utils/campaignWorker');

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
        companyName,
        subjectTemplates,
        bodyTemplates,
        settings,
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

        const recipients = (job.rows || [])
            .map(row => rowToRecipient(row, validOnly, job.headers))
            .filter(Boolean);

        if (!recipients.length) {
            return res.status(400).json({ message: 'No valid recipients in bulk job' });
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
            },
            recipients,
            status: 'draft',
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

        if (!['draft', 'paused'].includes(campaign.status)) {
            return res.status(400).json({ message: `Cannot start campaign in status: ${campaign.status}` });
        }

        campaign.status = 'running';
        campaign.startedAt = campaign.startedAt || new Date();
        campaign.lastError = '';
        await campaign.save();

        startCampaign(campaign._id);
        res.json({ message: 'Campaign started', id: campaign._id, status: 'running' });
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
};
