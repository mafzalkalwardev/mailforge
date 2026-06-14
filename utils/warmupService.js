const SenderAccount = require('../models/SenderAccount');

const WARMUP_RAMP = [20, 40, 60, 80, 100, 150, 200, 250, 300, 350, 400, 450];

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function getEffectiveDailyLimit(sender) {
    const max = sender.dailyLimit || 450;
    if (sender.warmupEnabled === false) return max;
    const day = Math.max(1, sender.warmupDay || 1);
    const ramp = WARMUP_RAMP[Math.min(day - 1, WARMUP_RAMP.length - 1)];
    return Math.min(ramp, max);
}

function getWarmupStatus(sender) {
    const limitToday = getEffectiveDailyLimit(sender);
    const sentToday = sender.sentToday || 0;
    return {
        enabled: sender.warmupEnabled !== false,
        day: sender.warmupDay || 1,
        limitToday,
        sentToday,
        remaining: Math.max(0, limitToday - sentToday),
        maxDay: WARMUP_RAMP.length,
    };
}

async function recordSenderSend(senderId) {
    const sender = await SenderAccount.findById(senderId);
    if (!sender) return;

    const today = todayKey();
    if (sender.lastSendDate !== today) {
        sender.sentToday = 0;
        sender.lastSendDate = today;
        if (sender.warmupEnabled !== false) {
            sender.warmupDay = Math.min((sender.warmupDay || 0) + 1, WARMUP_RAMP.length);
            if (sender.warmupDay < 1) sender.warmupDay = 1;
        }
    }
    sender.sentToday = (sender.sentToday || 0) + 1;
    sender.totalSent = (sender.totalSent || 0) + 1;
    await sender.save();
}

async function canSenderSendToday(senderId) {
    const sender = await SenderAccount.findById(senderId);
    if (!sender) return { ok: false, reason: 'Sender not found' };
    const today = todayKey();
    const sentToday = sender.lastSendDate === today ? (sender.sentToday || 0) : 0;
    const limit = getEffectiveDailyLimit(sender);
    if (sentToday >= limit) {
        return { ok: false, reason: `Warm-up/daily limit ${limit} reached for ${sender.email}`, limit, sentToday };
    }
    return { ok: true, limit, sentToday, remaining: limit - sentToday };
}

module.exports = {
    WARMUP_RAMP,
    getEffectiveDailyLimit,
    getWarmupStatus,
    recordSenderSend,
    canSenderSendToday,
};
