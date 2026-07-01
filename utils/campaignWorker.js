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

async function isCampaignStillRunning(campaignId) {
    return Boolean(await Campaign.exists({ _id: campaignId, status: 'running' }));
}

async function updateRecipientStatus(campaignId, recipientId, status, fields = {}) {
    const update = {
        $set: {
            'recipients.$.status': status,
            ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [`recipients.$.${key}`, value])),
        },
        $inc: {
            'stats.pending': -1,
            [`stats.${status}`]: 1,
        },
    };

    const result = await Campaign.updateOne(
        { _id: campaignId, 'recipients._id': recipientId, 'recipients.status': 'pending' },
        update
    );
    return result.modifiedCount > 0;
}

async function pauseCampaignWithError(campaignId, message) {
    await Campaign.updateOne(
        { _id: campaignId, status: 'running' },
        { $set: { status: 'paused', lastError: message } }
    );
}

async function warmUpSenders(senders, abort) {
    await Promise.all(senders.map(async sender => {
        if (abort.cancelled) return;
        try {
            await sendWarmUp(sender);
            await sleep(randomDelay(30000, 60000));
        } catch (err) {
            console.warn(`Warm-up failed for ${sender.email}:`, err.message);
        }
    }));
}

async function sendRecipientForSender({
    campaignId,
    campaignSnapshot,
    userSettings,
    maxPerHour,
    failurePausePct,
    sender,
    senderCounts,
    recipientRef,
    abort,
}) {
    if (abort.cancelled) return;
    if (!(await isCampaignStillRunning(campaignId))) {
        abort.cancelled = true;
        return;
    }

    const recipientId = recipientRef._id;
    const userId = String(campaignSnapshot.user);

    if (await isSuppressed(campaignSnapshot.user, recipientRef.email)) {
        await updateRecipientStatus(campaignId, recipientId, 'skipped', {
            error: 'On suppression list',
        });
        return;
    }

    if (maxPerHour > 0 && getHourlySendCount(userId) >= maxPerHour) {
        await updateRecipientStatus(campaignId, recipientId, 'skipped', {
            error: 'Hourly send limit reached',
        });
        await pauseCampaignWithError(campaignId, `Paused: hourly limit of ${maxPerHour} sends reached`);
        abort.cancelled = true;
        return;
    }

    const maxPerSender = campaignSnapshot.settings?.maxPerSender || 450;
    if ((senderCounts.get(String(sender._id)) || 0) >= maxPerSender) {
        await updateRecipientStatus(campaignId, recipientId, 'skipped', {
            error: 'Sender daily limit reached',
        });
        return;
    }

    const sendCap = await canSenderSendToday(sender._id);
    if (!sendCap.ok) {
        await updateRecipientStatus(campaignId, recipientId, 'skipped', {
            error: sendCap.reason,
        });
        return;
    }

    const row = { Email: recipientRef.email, ...(recipientRef.rowData || {}) };
    const { subject, body } = renderCampaignEmail(campaignSnapshot, row, sender, {
        userId: campaignSnapshot.user,
        appendCanSpamFooter: userSettings.appendCanSpamFooter,
        canSpamAddress: userSettings.canSpamAddress,
    });

    let lastError = '';
    const retries = campaignSnapshot.settings?.retries ?? 2;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (abort.cancelled) return;
        try {
            const messageId = await sendCampaignMessage(sender, recipientRef.email, subject, body);
            const updated = await updateRecipientStatus(campaignId, recipientId, 'sent', {
                subject,
                body,
                senderEmail: sender.email,
                messageId,
                sentAt: new Date(),
                error: '',
            });
            if (updated) {
                senderCounts.set(String(sender._id), (senderCounts.get(String(sender._id)) || 0) + 1);
                trackHourlySend(userId);
                await recordSenderSend(sender._id);
            }
            return;
        } catch (err) {
            lastError = err.message;
            if (attempt < retries) await sleep(3000);
        }
    }

    await updateRecipientStatus(campaignId, recipientId, 'failed', {
        error: lastError || 'Send failed',
    });

    const sk = `${campaignSnapshot.user}:${sender.email}`;
    const fails = (senderFailureCounts.get(sk) || 0) + 1;
    senderFailureCounts.set(sk, fails);
    const sentBySender = senderCounts.get(String(sender._id)) || 0;
    const failRate = sentBySender + fails > 0 ? (fails / (sentBySender + fails)) * 100 : 100;
    if (failRate >= failurePausePct && fails >= 3) {
        await pauseCampaignWithError(campaignId, `Paused: ${sender.email} failure rate ${Math.round(failRate)}%`);
        abort.cancelled = true;
    }
    if (looksLikeBounce(lastError)) {
        try {
            await addSuppression(campaignSnapshot.user, recipientRef.email, 'bounce', lastError.slice(0, 200));
        } catch (_) {}
    }
}

async function runSenderLane({
    campaignId,
    campaignSnapshot,
    userSettings,
    maxPerHour,
    failurePausePct,
    sender,
    chunk,
    senderCounts,
    abort,
}) {
    for (const recipientRef of chunk) {
        if (abort.cancelled) break;
        await sendRecipientForSender({
            campaignId,
            campaignSnapshot,
            userSettings,
            maxPerHour,
            failurePausePct,
            sender,
            senderCounts,
            recipientRef,
            abort,
        });
        if (!abort.cancelled) {
            await sleep(randomDelay(
                campaignSnapshot.settings?.minDelayMs || 5000,
                campaignSnapshot.settings?.maxDelayMs || 15000
            ));
        }
    }
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
            await warmUpSenders(senders, abort);
        }

        await Promise.all(senders.map((sender, si) => runSenderLane({
            campaignId,
            campaignSnapshot: campaign,
            userSettings,
            maxPerHour,
            failurePausePct,
            sender,
            chunk: chunks[si] || [],
            senderCounts,
            abort,
        })));

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
