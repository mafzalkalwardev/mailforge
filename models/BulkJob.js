const mongoose = require('mongoose');

const BulkJobSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fileName: { type: String, required: true },
    headers: [{ type: String }],
    rows: [{
        email: String,
        originalRow: { type: [mongoose.Schema.Types.Mixed], default: [] },
        valid: Boolean,
        domain_valid: Boolean,
        mailbox_verified: String,
        smtp_response: String,
        status: String,
    }],
    stats: {
        total: { type: Number, default: 0 },
        valid: { type: Number, default: 0 },
        invalid: { type: Number, default: 0 },
        disposable: { type: Number, default: 0 },
        noSmtp: { type: Number, default: 0 },
    },
    completedAt: { type: Date, default: Date.now },
    isPartial: { type: Boolean, default: false },
    verifyJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'VerifyJob' },
});

module.exports = mongoose.model('BulkJob', BulkJobSchema);
