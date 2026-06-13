const VerifyJob = require('../models/VerifyJob');
const BulkJob = require('../models/BulkJob');
const { verifyEmailCombined } = require('./verificationEngine');
const { getSettingsForUser } = require('./settingsService');

const activeWorkers = new Map();

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function tallyResult(stats, result) {
    stats.completed++;
    if (result.valid) {
        stats.valid++;
        return;
    }
    const status = String(result.status || '').toLowerCase();
    if (status === 'disposable' || result.misc?.disposable) stats.disposable++;
    else if (result.mailbox_verified === 'unknown' || status === 'unknown') {
        stats.noSmtp = (stats.noSmtp || 0) + 1;
    } else if (result.mailbox_verified === 'no_smtp' || status === 'no_smtp') stats.noSmtp++;
    else stats.invalid++;
}

function resultToRow(result, fileRow) {
    return {
        email: fileRow.email,
        originalRow: fileRow.originalRow || [],
        valid: !!result.valid,
        domain_valid: !!result.domain_valid,
        mailbox_verified: result.mailbox_verified || 'no_smtp',
        smtp_response: result.smtp_response || '',
        status: result.status || (result.valid ? 'valid' : 'invalid'),
    };
}

async function saveToBulkHistory(job) {
    const rows = (job.fileRows || []).map(fr => {
        const r = job.resultsByEmail[fr.email] || {};
        return resultToRow(r, fr);
    });

    const bulk = await BulkJob.create({
        user: job.user,
        fileName: job.fileName,
        headers: job.headers || [],
        rows,
        stats: {
            total: rows.length,
            valid: job.stats.valid,
            invalid: job.stats.invalid,
            disposable: job.stats.disposable,
            noSmtp: job.stats.noSmtp,
        },
        completedAt: new Date(),
    });

    job.bulkJobId = bulk._id;
    await job.save();
    return bulk._id;
}

async function runVerifyJobWorker(jobId) {
    if (activeWorkers.has(String(jobId))) return;

    const abort = { cancelled: false };
    activeWorkers.set(String(jobId), abort);

    try {
        let job = await VerifyJob.findById(jobId);
        if (!job || job.status === 'cancelled' || abort.cancelled) {
            activeWorkers.delete(String(jobId));
            return;
        }
        if (job.status === 'paused') {
            activeWorkers.delete(String(jobId));
            return;
        }
        if (!['queued', 'running'].includes(job.status)) {
            activeWorkers.delete(String(jobId));
            return;
        }

        if (job.status === 'queued') {
            const fresh = await VerifyJob.findById(jobId);
            if (!fresh || fresh.status === 'paused' || fresh.status === 'cancelled') {
                activeWorkers.delete(String(jobId));
                return;
            }
            fresh.status = 'running';
            fresh.startedAt = fresh.startedAt || new Date();
            await fresh.save();
            job = fresh;
        }

        const settings = await getSettingsForUser(job.user);
        const concurrency = Math.min(Math.max(parseInt(settings.bulkConcurrency || '3', 10), 1), 5);

        while (true) {
            job = await VerifyJob.findById(jobId);
            if (!job || job.status === 'cancelled' || abort.cancelled) break;
            if (job.status === 'paused') {
                activeWorkers.delete(String(jobId));
                return;
            }
            if (job.status !== 'running') break;

            const emails = job.emails || [];
            if (job.nextEmailIndex >= emails.length) break;

            const batch = emails.slice(job.nextEmailIndex, job.nextEmailIndex + concurrency);

            const outcomes = await Promise.all(
                batch.map(async email => {
                    try {
                        const result = await verifyEmailCombined(email, job.user);
                        return { email, result };
                    } catch (err) {
                        return {
                            email,
                            result: {
                                email,
                                valid: false,
                                domain_valid: false,
                                mailbox_verified: 'no_smtp',
                                smtp_response: '',
                                status: 'error',
                                error: err.message,
                            },
                        };
                    }
                })
            );

            for (const { email, result } of outcomes) {
                job.resultsByEmail[email] = result;
                tallyResult(job.stats, result);
            }

            job.nextEmailIndex += batch.length;
            job.markModified('resultsByEmail');
            job.markModified('stats');
            await job.save();

            await sleep(100);
        }

        job = await VerifyJob.findById(jobId);
        if (job && job.status === 'running') {
            job.status = 'completed';
            job.completedAt = new Date();
            await job.save();
            try {
                await saveToBulkHistory(job);
            } catch (err) {
                console.error('Failed to save bulk history:', err.message);
            }
        }
    } catch (err) {
        console.error('Verify job worker error:', err);
        const job = await VerifyJob.findById(jobId);
        if (job && job.status === 'running') {
            job.status = 'failed';
            job.lastError = err.message;
            job.completedAt = new Date();
            await job.save();
        }
    } finally {
        activeWorkers.delete(String(jobId));
    }
}

function startVerifyJob(jobId) {
    setImmediate(() => runVerifyJobWorker(jobId));
}

function cancelVerifyJob(jobId) {
    const abort = activeWorkers.get(String(jobId));
    if (abort) abort.cancelled = true;
}

async function pauseVerifyJob(jobId) {
    const job = await VerifyJob.findById(jobId);
    if (!job || !['queued', 'running'].includes(job.status)) return false;
    job.status = 'paused';
    await job.save();
    cancelVerifyJob(jobId);
    return true;
}

async function resumeVerifyJob(jobId) {
    const job = await VerifyJob.findById(jobId);
    if (!job || job.status !== 'paused') return false;
    job.status = 'running';
    await job.save();
    startVerifyJob(jobId);
    return true;
}

function isVerifyJobRunning(jobId) {
    return activeWorkers.has(String(jobId));
}

async function resumeInterruptedJobs() {
    const jobs = await VerifyJob.find({ status: { $in: ['queued', 'running'] } });
    for (const job of jobs) {
        console.log(`Resuming verify job ${job._id} (${job.stats?.completed || 0}/${job.emails?.length || 0})`);
        startVerifyJob(job._id);
    }
    const paused = await VerifyJob.countDocuments({ status: 'paused' });
    if (paused) console.log(`${paused} verify job(s) paused — resume from Bulk Verify page`);
}

function buildRecentResults(job, limit = 30) {
    const emails = (job.emails || []).slice(0, job.nextEmailIndex);
    const recent = emails.slice(-limit);
    return recent.map(email => {
        const r = job.resultsByEmail[email] || {};
        return {
            email,
            domain_valid: !!r.domain_valid,
            mailbox_verified: r.mailbox_verified || 'no_smtp',
            valid: !!r.valid,
            smtp_response: r.smtp_response || '',
            status: r.status || 'unknown',
        };
    }).reverse();
}

function buildAllRows(job) {
    return (job.fileRows || []).map(fr => {
        const r = job.resultsByEmail[fr.email] || {};
        return resultToRow(r, fr);
    });
}

module.exports = {
    startVerifyJob,
    cancelVerifyJob,
    pauseVerifyJob,
    resumeVerifyJob,
    isVerifyJobRunning,
    resumeInterruptedJobs,
    buildRecentResults,
    buildAllRows,
};
