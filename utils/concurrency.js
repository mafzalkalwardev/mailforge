const DEFAULT_BULK_CONCURRENCY = 15;
const MAX_BULK_CONCURRENCY = 50;

function sanitizeBulkConcurrency(value, fallback = DEFAULT_BULK_CONCURRENCY) {
    const parsed = parseInt(value, 10);
    const safeFallback = Number.isFinite(parseInt(fallback, 10))
        ? parseInt(fallback, 10)
        : DEFAULT_BULK_CONCURRENCY;

    if (!Number.isFinite(parsed)) {
        return Math.min(Math.max(safeFallback, 1), MAX_BULK_CONCURRENCY);
    }

    return Math.min(Math.max(parsed, 1), MAX_BULK_CONCURRENCY);
}

module.exports = {
    DEFAULT_BULK_CONCURRENCY,
    MAX_BULK_CONCURRENCY,
    sanitizeBulkConcurrency,
};
