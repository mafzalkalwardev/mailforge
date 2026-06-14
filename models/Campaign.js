const mongoose = require('mongoose');

const RecipientSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, lowercase: true, trim: true },
        rowData: { type: mongoose.Schema.Types.Mixed, default: {} },
        status: {
            type: String,
            enum: ['pending', 'sent', 'failed', 'skipped'],
            default: 'pending',
        },
        subject: String,
        error: String,
        senderEmail: String,
        messageId: String,
        sentAt: Date,
    },
    { _id: true }
);

const CampaignSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true, trim: true },
        bulkJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'BulkJob' },
        templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailTemplate' },
        companyName: { type: String, trim: true, default: '' },
        subjectTemplates: [{ type: String }],
        bodyTemplates: [{ type: String }],
        senderAccountIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SenderAccount' }],
        status: {
            type: String,
            enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'failed', 'cancelled'],
            default: 'draft',
        },
        scheduledAt: { type: Date },
        validOnly: { type: Boolean, default: true },
        settings: {
            minDelayMs: { type: Number, default: 5000 },
            maxDelayMs: { type: Number, default: 15000 },
            retries: { type: Number, default: 2 },
            maxPerSender: { type: Number, default: 450 },
            warmUp: { type: Boolean, default: true },
        },
        recipients: [RecipientSchema],
        stats: {
            total: { type: Number, default: 0 },
            pending: { type: Number, default: 0 },
            sent: { type: Number, default: 0 },
            failed: { type: Number, default: 0 },
            skipped: { type: Number, default: 0 },
            replies: { type: Number, default: 0 },
        },
        startedAt: Date,
        completedAt: Date,
        lastError: String,
    },
    { timestamps: true }
);

module.exports = mongoose.model('Campaign', CampaignSchema);
