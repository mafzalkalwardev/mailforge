const fs = require('fs');
const VerifyJob = require('../models/VerifyJob');
const { parseBulkFile } = require('../utils/csvEmailParser');
const {
    startVerifyJob,
    cancelVerifyJob,
    buildRecentResults,
    buildAllRows,
} = require('../utils/bulkVerifyWorker');

function jobProgress(job) {
    const total = job.stats?.totalEmails || job.emails?.length || 0;
    const completed = job.stats?.completed || 0;
    return {
        total,
        completed,
        percent: total ? Math.round((completed / total) * 100) : 0,
    };
}

function serializeJob(job, { includeRows = false } = {}) {
    const progress = jobProgress(job);
    const payload = {
        _id: job._id,
        fileName: job.fileName,
        headers: job.headers,
        status: job.status,
        stats: job.stats,
        progress,
        bulkJobId: job.bulkJobId,
        lastError: job.lastError,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
        recentResults: buildRecentResults(job),
    };

    if (includeRows || job.status === 'completed') {
        payload.rows = buildAllRows(job);
    }

    return payload;
}

const startJobFromUpload = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Please upload a file' });
    }

    const filePath = req.file.path;

    try {
        const running = await VerifyJob.findOne({
            user: req.user._id,
            status: { $in: ['queued', 'running'] },
        });

        if (running) {
            return res.status(409).json({
                message: 'A verification job is already running. Wait for it to finish or cancel it first.',
                jobId: running._id,
            });
        }

        const isCsv =
            req.file.mimetype === 'text/csv' ||
            req.file.originalname.endsWith('.csv');
        const isXlsx =
            req.file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            req.file.originalname.endsWith('.xlsx');

        if (!isCsv && !isXlsx) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ message: 'Unsupported file format. Use .csv or .xlsx' });
        }

        const parsed = parseBulkFile(filePath, req.file.originalname);
        fs.unlinkSync(filePath);

        if (!parsed.emails?.length) {
            return res.status(400).json({ message: 'No valid emails found in file' });
        }

        const fileRows = (parsed.rows || []).map(r => ({
            email: r.email,
            originalRow: r.originalRow || [],
            rowIndex: r.rowIndex,
        }));

        const job = await VerifyJob.create({
            user: req.user._id,
            fileName: req.file.originalname,
            headers: parsed.headers || [],
            fileRows,
            emails: parsed.emails,
            status: 'queued',
            stats: {
                totalEmails: parsed.emails.length,
                totalRows: fileRows.length,
                completed: 0,
                valid: 0,
                invalid: 0,
                disposable: 0,
                noSmtp: 0,
            },
        });

        startVerifyJob(job._id);

        res.status(201).json(serializeJob(job));
    } catch (error) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ message: 'Failed to start verification job', error: error.message });
    }
};

const getActiveJob = async (req, res) => {
    try {
        const job = await VerifyJob.findOne({
            user: req.user._id,
            status: { $in: ['queued', 'running'] },
        }).sort({ createdAt: -1 });

        if (!job) return res.json({ active: false, job: null });
        res.json({ active: true, job: serializeJob(job) });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching active job', error: error.message });
    }
};

const getJobById = async (req, res) => {
    try {
        const job = await VerifyJob.findOne({ _id: req.params.id, user: req.user._id });
        if (!job) return res.status(404).json({ message: 'Job not found' });

        const includeRows = req.query.full === '1' || job.status === 'completed';
        res.json(serializeJob(job, { includeRows }));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching job', error: error.message });
    }
};

const cancelJob = async (req, res) => {
    try {
        const job = await VerifyJob.findOne({ _id: req.params.id, user: req.user._id });
        if (!job) return res.status(404).json({ message: 'Job not found' });

        if (!['queued', 'running'].includes(job.status)) {
            return res.status(400).json({ message: `Job is already ${job.status}` });
        }

        cancelVerifyJob(job._id);
        job.status = 'cancelled';
        job.completedAt = new Date();
        await job.save();

        res.json({ message: 'Job cancelled', job: serializeJob(job) });
    } catch (error) {
        res.status(500).json({ message: 'Error cancelling job', error: error.message });
    }
};

const listRecentJobs = async (req, res) => {
    try {
        const jobs = await VerifyJob.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .limit(10)
            .select('fileName status stats createdAt completedAt bulkJobId');
        res.json(jobs);
    } catch (error) {
        res.status(500).json({ message: 'Error listing jobs', error: error.message });
    }
};

module.exports = {
    startJobFromUpload,
    getActiveJob,
    getJobById,
    cancelJob,
    listRecentJobs,
};
