const mongoose = require('mongoose');

const VerifyJobSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        fileName: { type: String, required: true },
        headers: [{ type: String }],
        fileRows: [
            {
                email: String,
                originalRow: { type: [mongoose.Schema.Types.Mixed], default: [] },
                rowIndex: Number,
            },
        ],
        emails: [{ type: String }],
        resultsByEmail: { type: mongoose.Schema.Types.Mixed, default: {} },
        status: {
            type: String,
            enum: ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'],
            default: 'queued',
        },
        nextEmailIndex: { type: Number, default: 0 },
        stats: {
            totalEmails: { type: Number, default: 0 },
            totalRows: { type: Number, default: 0 },
            completed: { type: Number, default: 0 },
            valid: { type: Number, default: 0 },
            invalid: { type: Number, default: 0 },
            disposable: { type: Number, default: 0 },
            noSmtp: { type: Number, default: 0 },
        },
        bulkJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'BulkJob' },
        lastError: String,
        startedAt: Date,
        completedAt: Date,
    },
    { timestamps: true }
);

VerifyJobSchema.index({ user: 1, status: 1 });
VerifyJobSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('VerifyJob', VerifyJobSchema);
