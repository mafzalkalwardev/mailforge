const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_BULK_CONCURRENCY,
    MAX_BULK_CONCURRENCY,
    sanitizeBulkConcurrency,
} = require('../utils/concurrency');

describe('bulk concurrency', () => {
    it('defaults to a faster local worker count', () => {
        assert.equal(DEFAULT_BULK_CONCURRENCY, 15);
        assert.equal(sanitizeBulkConcurrency(undefined), 15);
    });

    it('allows higher parallelism but caps unsafe values', () => {
        assert.equal(sanitizeBulkConcurrency(25), 25);
        assert.equal(sanitizeBulkConcurrency(999), MAX_BULK_CONCURRENCY);
    });

    it('never returns less than one worker', () => {
        assert.equal(sanitizeBulkConcurrency(0), 1);
        assert.equal(sanitizeBulkConcurrency(-5), 1);
    });
});
