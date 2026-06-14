const ValidationHistory = require('../models/ValidationHistory');
const BulkJob = require('../models/BulkJob');
const VerifyJob = require('../models/VerifyJob');
const Campaign = require('../models/Campaign');
const { classifyHistoryRecord } = require('../utils/statusUtils');
const { analyzeListHygiene, filterRowsForExport, rowsToCsv, dedupeRows } = require('../utils/bulkJobUtils');
const { startVerifyJob } = require('../utils/bulkVerifyWorker');

// @desc    Get user validation history
// @route   GET /api/history
// @access  Private
const getHistory = async (req, res) => {
    try {
        const history = await ValidationHistory.find({ user: req.user._id }).sort({ timestamp: -1 });
        res.json(history);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching history', error: error.message });
    }
};

// @desc    Get validation stats
// @route   GET /api/history/stats
// @access  Private
const getStats = async (req, res) => {
    try {
        const history = await ValidationHistory.find({ user: req.user._id });

        const total = history.length;
        let valid = 0;
        let invalid = 0;
        let unknown = 0;

        history.forEach(record => {
            const bucket = classifyHistoryRecord(record);
            if (bucket === 'valid') valid++;
            else if (bucket === 'unknown') unknown++;
            else invalid++;
        });

        res.json({ total, valid, invalid, unknown });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching stats', error: error.message });
    }
};

// @desc    List saved bulk jobs
// @route   GET /api/history/bulk-jobs
// @access  Private
const getBulkJobs = async (req, res) => {
    try {
        const jobs = await BulkJob.find({ user: req.user._id })
            .sort({ completedAt: -1 })
            .select('-rows');

        const ids = jobs.map(j => j._id);
        const campaignCounts = await Campaign.aggregate([
            { $match: { user: req.user._id, bulkJobId: { $in: ids } } },
            { $group: { _id: '$bulkJobId', count: { $sum: 1 } } },
        ]);
        const countMap = Object.fromEntries(campaignCounts.map(c => [String(c._id), c.count]));

        res.json(jobs.map(j => ({
            ...j.toObject(),
            campaignCount: countMap[String(j._id)] || 0,
        })));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching bulk jobs', error: error.message });
    }
};

// @desc    Get one bulk job with rows (for export)
// @route   GET /api/history/bulk-jobs/:id
// @access  Private
const getBulkJobById = async (req, res) => {
    try {
        const job = await BulkJob.findOne({ _id: req.params.id, user: req.user._id });
        if (!job) {
            return res.status(404).json({ message: 'Bulk job not found' });
        }
        res.json(job);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching bulk job', error: error.message });
    }
};

// @desc    Save completed bulk job
// @route   POST /api/history/bulk-jobs
// @access  Private
const saveBulkJob = async (req, res) => {
    const { fileName, rows, stats, headers } = req.body;

    if (!fileName || !Array.isArray(rows) || !rows.length) {
        return res.status(400).json({ message: 'fileName and rows are required' });
    }

    try {
        const job = await BulkJob.create({
            user: req.user._id,
            fileName,
            headers: Array.isArray(headers) ? headers : [],
            rows,
            stats: {
                total: rows.length,
                valid: stats?.valid ?? rows.filter(r => r.valid).length,
                invalid: stats?.invalid ?? rows.filter(r => !r.valid).length,
                disposable: stats?.disposable ?? 0,
                noSmtp: stats?.noSmtp ?? 0,
            },
        });
        res.status(201).json({ id: job._id, fileName: job.fileName });
    } catch (error) {
        res.status(500).json({ message: 'Error saving bulk job', error: error.message });
    }
};

const getBulkJobHygiene = async (req, res) => {
    try {
        const job = await BulkJob.findOne({ _id: req.params.id, user: req.user._id });
        if (!job) return res.status(404).json({ message: 'Bulk job not found' });
        res.json(analyzeListHygiene(job.rows, job.completedAt));
    } catch (error) {
        res.status(500).json({ message: 'Error analyzing list', error: error.message });
    }
};

const exportBulkJobCsv = async (req, res) => {
    try {
        const job = await BulkJob.findOne({ _id: req.params.id, user: req.user._id });
        if (!job) return res.status(404).json({ message: 'Bulk job not found' });
        const filter = req.query.filter || 'all';
        let rows = filterRowsForExport(job.rows, filter);
        if (req.query.dedupe === '1') rows = dedupeRows(rows, 'valid');
        const csv = rowsToCsv(job.headers, rows);
        const suffix = filter === 'valid' ? '_valid' : filter === 'valid_unknown' ? '_valid_unknown' : '_all';
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${(job.fileName || 'export').replace(/\.[^.]+$/, '')}${suffix}.csv"`);
        res.send(csv);
    } catch (error) {
        res.status(500).json({ message: 'Export failed', error: error.message });
    }
};

const reverifyBulkJob = async (req, res) => {
    try {
        const bulk = await BulkJob.findOne({ _id: req.params.id, user: req.user._id });
        if (!bulk) return res.status(404).json({ message: 'Bulk job not found' });

        const running = await VerifyJob.findOne({
            user: req.user._id,
            status: { $in: ['queued', 'running', 'paused'] },
        });
        if (running) {
            return res.status(409).json({ message: 'A verification job is already in progress' });
        }

        let rows = bulk.rows || [];
        if (req.body?.validOnly) rows = rows.filter(r => r.valid);
        if (req.body?.dedupe) rows = dedupeRows(rows, 'valid');

        const emails = [...new Set(rows.map(r => String(r.email || '').toLowerCase().trim()).filter(Boolean))];
        if (!emails.length) return res.status(400).json({ message: 'No emails to re-verify' });

        const fileRows = rows.map((r, idx) => ({
            email: String(r.email).toLowerCase(),
            originalRow: r.originalRow || [],
            rowIndex: idx,
        }));

        const job = await VerifyJob.create({
            user: req.user._id,
            fileName: `reverify-${bulk.fileName}`,
            headers: bulk.headers || [],
            fileRows,
            emails,
            status: 'queued',
            stats: {
                totalEmails: emails.length,
                totalRows: fileRows.length,
                completed: 0,
                valid: 0,
                invalid: 0,
                disposable: 0,
                noSmtp: 0,
            },
        });

        startVerifyJob(job._id);
        res.status(201).json({ message: 'Re-verification started', jobId: job._id, total: emails.length });
    } catch (error) {
        res.status(500).json({ message: 'Re-verify failed', error: error.message });
    }
};

module.exports = {
    getHistory,
    getStats,
    getBulkJobs,
    getBulkJobById,
    saveBulkJob,
    getBulkJobHygiene,
    exportBulkJobCsv,
    reverifyBulkJob,
};
