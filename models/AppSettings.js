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
            default: 'truemail',
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
            max: 50,
            default: 15,
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
        groqApiKey: {
            type: String,
            default: '',
            trim: true,
        },
        openrouterApiKey: {
            type: String,
            default: '',
            trim: true,
        },
        aiProvider: {
            type: String,
            enum: ['groq', 'openai', 'openrouter'],
            default: 'groq',
        },
        aiModel: {
            type: String,
            default: '',
            trim: true,
        },
        autoRedirectAfterVerify: {
            type: Boolean,
            default: true,
        },
        canSpamAddress: { type: String, default: '', trim: true },
        appendCanSpamFooter: { type: Boolean, default: false },
        maxSendsPerHour: { type: Number, min: 0, max: 5000, default: 0 },
        senderFailurePausePercent: { type: Number, min: 0, max: 100, default: 25 },
        savePartialOnPause: { type: Boolean, default: true },
    },
    { timestamps: true }
);

module.exports = mongoose.model('AppSettings', AppSettingsSchema);
