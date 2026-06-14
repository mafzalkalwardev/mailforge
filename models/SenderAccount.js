const mongoose = require('mongoose');

const SenderAccountSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        email: { type: String, required: true, trim: true, lowercase: true },
        displayName: { type: String, trim: true, default: '' },
        authMethod: { type: String, enum: ['app_password'], default: 'app_password' },
        encryptedPassword: { type: String, required: true },
        smtpHost: { type: String, default: 'smtp.gmail.com' },
        smtpPort: { type: Number, default: 465 },
        imapHost: { type: String, default: 'imap.gmail.com' },
        imapPort: { type: Number, default: 993 },
        dailyLimit: { type: Number, default: 450, min: 1 },
        enabled: { type: Boolean, default: true },
        warmupEnabled: { type: Boolean, default: true },
        warmupDay: { type: Number, default: 1, min: 1 },
        sentToday: { type: Number, default: 0, min: 0 },
        lastSendDate: { type: String, default: '' },
        totalSent: { type: Number, default: 0, min: 0 },
        dnsAuth: {
            score: { type: Number, default: 0 },
            spfOk: { type: Boolean, default: false },
            dmarcOk: { type: Boolean, default: false },
            dkimOk: { type: Boolean, default: false },
            warnings: [{ type: String }],
            checkedAt: { type: Date },
        },
        lastSyncAt: { type: Date },
    },
    { timestamps: true }
);

SenderAccountSchema.index({ user: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('SenderAccount', SenderAccountSchema);
