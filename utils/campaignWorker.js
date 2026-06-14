const Campaign = require('../models/Campaign');
const SenderAccount = require('../models/SenderAccount');
const { renderCampaignEmail } = require('./templateRenderer');
const { sendWarmUp, sendCampaignMessage } = require('./smtpClient');
const { isSuppressed, addSuppression, looksLikeBounce } = require('./suppressionService');
const { getSettingsForUser } = require('./settingsService');

const { canSenderSendToday, recordSenderSend } = require('./warmupService');
const hourlySendCounts = new Map();
const senderFailureCounts = new Map();

function hourKey(userId) {
    const d = new Date();
    return `${userId}:${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
}

function trackHourlySend(userId) {
    const key = hourKey(userId);
    hourlySendCounts.set(key, (hourlySendCounts.get(key) || 0) + 1);
}

function getHourlySendCount(userId) {
    return hourlySendCounts.get(hourKey(userId)) || 0;
}

const activeWorkers = new Map();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
    const min = Math.max(0, minMs);
    const max = Math.max(min, maxMs);
    return min + Math.random() * (max - min);
}

function recomputeStats(campaign) {
    const recipients = campaign.recipients || [];
    campaign.stats = {
        total: recipients.length,
        pending: recipients.filter(r => r.status === 'pending').length,
        sent: recipients.filter(r => r.status === 'sent').length,
        failed: recipients.filter(r => r.status === 'failed').length,
        skipped: recipients.filter(r => r.status === 'skipped').length,
    };
}

function splitRecipientsEvenly(recipients, numSenders) {
    if (numSenders <= 1) return [recipients];
    const chunks = Array.from({ length: numSenders }, () => []);
    recipients.forEach((r, i) => chunks[i % numSenders].push(r));
    return chunks;
}

async function runCampaignWorker(campaignId) {
    if (activeWorkers.get(String(campaignId))) return;

    const abort = { cancelled: false };
    activeWorkers.set(String(campaignId), abort);

    try {
        let campaign = await Campaign.findById(campaignId);
        if (!campaign || campaign.status !== 'running') {
            activeWorkers.delete(String(campaignId));
            return;
        }

        const senders = await SenderAccount.find({
            _id: { $in: campaign.senderAccountIds },
            enabled: true,
        });

        if (!senders.length) {
            campaign.status = 'failed';
            campaign.lastError = 'No enabled sender accounts';
            campaign.completedAt = new Date();
            await campaign.save();
            activeWorkers.delete(String(campaignId));
            return;
        }

        const userSettings = await getSettingsForUser(campaign.user);
        const maxPerHour = userSettings.maxSendsPerHour || 0;
        const failurePausePct = userSettings.senderFailurePausePercent || 25;

        const pending = campaign.recipients.filter(r => r.status === 'pending');
        const chunks = splitRecipientsEvenly(pending, senders.length);
        const senderCounts = new Map(senders.map(s => [String(s._id), 0]));

        if (campaign.settings?.warmUp) {
            for (const sender of senders) {
                if (abort.cancelled) break;
                try {
                    await sendWarmUp(sender);
                    await sleep(randomDelay(30000, 60000));
                } catch (err) {
                    console.warn(`Warm-up failed for ${sender.email}:`, err.message);
                }
            }
        }

        for (let si = 0; si < senders.length; si++) {
            const sender = senders[si];
            const chunk = chunks[si] || [];
            const maxPerSender = campaign.settings?.maxPerSender || 450;
            const retries = campaign.settings?.retries ?? 2;

            for (const recipientRef of chunk) {
                if (abort.cancelled) break;

                campaign = await Campaign.findById(campaignId);
                if (!campaign || campaign.status !== 'running') break;

                const recipient = campaign.recipients.id(recipientRef._id);
                if (!recipient || recipient.status !== 'pending') continue;

                if (await isSuppressed(campaign.user, recipient.email)) {
                    recipient.status = 'skipped';
                    recipient.error = 'On suppression list';
                    recomputeStats(campaign);
                    await campaign.save();
                    continue;
                }

                if (maxPerHour > 0 && getHourlySendCount(String(campaign.user)) >= maxPerHour) {
                    recipient.status = 'skipped';
                    recipient.error = 'Hourly send limit reached';
                    recomputeStats(campaign);
                    await campaign.save();
                    campaign.status = 'paused';
                    campaign.lastError = `Paused: hourly limit of ${maxPerHour} sends reached`;
                    await campaign.save();
                    abort.cancelled = true;
                    break;
                }

                if ((senderCounts.get(String(sender._id)) || 0) >= maxPerSender) {
                    recipient.status = 'skipped';
                    recipient.error = 'Sender daily limit reached';
                    recomputeStats(campaign);
                    await campaign.save();
                    continue;
                }

                const sendCap = await canSenderSendToday(sender._id);
                if (!sendCap.ok) {
                    recipient.status = 'skipped';
                    recipient.error = sendCap.reason;
                    recomputeStats(campaign);
                    await campaign.save();
                    continue;
                }

                const row = { Email: recipient.email, ...(recipient.rowData || {}) };
                const { subject, body } = renderCampaignEmail(campaign, row, sender, {
                    userId: campaign.user,
                    appendCanSpamFooter: userSettings.appendCanSpamFooter,
                    canSpamAddress: userSettings.canSpamAddress,
                });

                let success = false;
                let lastError = '';
                for (let attempt = 0; attempt <= retries; attempt++) {
                    try {
                        const messageId = await sendCampaignMessage(sender, recipient.email, subject, body);
                        recipient.status = 'sent';
                        recipient.subject = subject;
                        recipient.senderEmail = sender.email;
                        recipient.messageId = messageId;
                        recipient.sentAt = new Date();
                        recipient.error = '';
                        success = true;
                        senderCounts.set(String(sender._id), (senderCounts.get(String(sender._id)) || 0) + 1);
                        trackHourlySend(String(campaign.user));
                        await recordSenderSend(sender._id);
                        break;
                    } catch (err) {
                        lastError = err.message;
                        if (attempt < retries) await sleep(3000);
                    }
                }

                if (!success) {
                    recipient.status = 'failed';
                    recipient.error = lastError || 'Send failed';
                    const sk = `${campaign.user}:${sender.email}`;
                    const fails = (senderFailureCounts.get(sk) || 0) + 1;
                    senderFailureCounts.set(sk, fails);
                    const sentBySender = senderCounts.get(String(sender._id)) || 0;
                    const failRate = sentBySender + fails > 0 ? (fails / (sentBySender + fails)) * 100 : 100;
                    if (failRate >= failurePausePct && fails >= 3) {
                        campaign.lastError = `Paused: ${sender.email} failure rate ${Math.round(failRate)}%`;
                        campaign.status = 'paused';
                        await campaign.save();
                        abort.cancelled = true;
                    }
                    if (looksLikeBounce(lastError)) {
                        try {
                            await addSuppression(campaign.user, recipient.email, 'bounce', lastError.slice(0, 200));
                        } catch (_) {}
                    }
                }

                recomputeStats(campaign);
                await campaign.save();

                await sleep(randomDelay(campaign.settings?.minDelayMs || 5000, campaign.settings?.maxDelayMs || 15000));
            }
        }

        campaign = await Campaign.findById(campaignId);
        if (campaign && campaign.status === 'running') {
            recomputeStats(campaign);
            campaign.status = campaign.stats.pending > 0 ? 'paused' : 'completed';
            if (campaign.status === 'completed') campaign.completedAt = new Date();
            await campaign.save();
        }
    } catch (err) {
        console.error('Campaign worker error:', err);
        const campaign = await Campaign.findById(campaignId);
        if (campaign) {
            campaign.status = 'failed';
            campaign.lastError = err.message;
            campaign.completedAt = new Date();
            await campaign.save();
        }
    } finally {
        activeWorkers.delete(String(campaignId));
    }
}

function startCampaign(campaignId) {
    setImmediate(() => runCampaignWorker(campaignId));
}

function pauseCampaign(campaignId) {
    const abort = activeWorkers.get(String(campaignId));
    if (abort) abort.cancelled = true;
}

function isCampaignRunning(campaignId) {
    return activeWorkers.has(String(campaignId));
}

module.exports = { startCampaign, pauseCampaign, isCampaignRunning, splitRecipientsEvenly, recomputeStats };
