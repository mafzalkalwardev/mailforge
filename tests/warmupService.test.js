const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getEffectiveDailyLimit, getWarmupStatus } = require('../utils/warmupService');

describe('warmupService', () => {
    it('ramps daily limit by warmup day', () => {
        const sender = { dailyLimit: 450, warmupEnabled: true, warmupDay: 1, sentToday: 0 };
        assert.equal(getEffectiveDailyLimit(sender), 20);
        sender.warmupDay = 5;
        assert.equal(getEffectiveDailyLimit(sender), 100);
    });

    it('returns remaining sends in status', () => {
        const status = getWarmupStatus({ dailyLimit: 450, warmupDay: 3, sentToday: 10, warmupEnabled: true });
        assert.equal(status.limitToday, 60);
        assert.equal(status.remaining, 50);
    });
});
