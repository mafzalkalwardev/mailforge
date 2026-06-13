const mongoose = require('mongoose');

const AppSettingsSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
        },
        verifierEngine: {
            type: String,
            enum: ['auto', 'truemail', 'reacher'],
            default: 'auto',
        },
        goVerifierUrl: {
            type: String,
            default: '',
            trim: true,
        },
        reacherUrl: {
            type: String,
            default: '',
            trim: true,
        },
        smtpProxy: {
            type: String,
            default: '',
            trim: true,
        },
        bulkConcurrency: {
            type: Number,
            min: 1,
            max: 5,
            default: 3,
        },
        reacherTimeoutMs: {
            type: Number,
            min: 5000,
            max: 180000,
            default: 45000,
        },
        openaiApiKey: {
            type: String,
            default: '',
            trim: true,
        },
        autoRedirectAfterVerify: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('AppSettings', AppSettingsSchema);
