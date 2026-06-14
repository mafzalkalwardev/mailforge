const Campaign = require('../models/Campaign');
const { startCampaign } = require('./campaignWorker');

let timer = null;

async function tickScheduledCampaigns() {
    try {
        const due = await Campaign.find({
            status: 'scheduled',
            scheduledAt: { $lte: new Date() },
        }).select('_id');

        for (const c of due) {
            const campaign = await Campaign.findById(c._id);
            if (!campaign || campaign.status !== 'scheduled') continue;
            campaign.status = 'running';
            campaign.startedAt = campaign.startedAt || new Date();
            campaign.lastError = '';
            await campaign.save();
            startCampaign(campaign._id);
            console.log(`Started scheduled campaign ${campaign._id} (${campaign.name})`);
        }
    } catch (err) {
        console.warn('Campaign scheduler tick failed:', err.message);
    }
}

function startCampaignScheduler(intervalMs = 60000) {
    if (timer) return;
    timer = setInterval(tickScheduledCampaigns, intervalMs);
    setTimeout(tickScheduledCampaigns, 5000);
}

function stopCampaignScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = { startCampaignScheduler, stopCampaignScheduler, tickScheduledCampaigns };
