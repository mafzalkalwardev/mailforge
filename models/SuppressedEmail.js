const mongoose = require('mongoose');

const SuppressedEmailSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        email: { type: String, required: true, trim: true, lowercase: true },
        reason: {
            type: String,
            enum: ['manual', 'bounce', 'unsubscribe', 'complaint', 'import'],
            default: 'manual',
        },
        note: { type: String, trim: true, default: '' },
    },
    { timestamps: true }
);

SuppressedEmailSchema.index({ user: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('SuppressedEmail', SuppressedEmailSchema);
