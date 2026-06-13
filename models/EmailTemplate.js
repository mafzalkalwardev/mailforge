const mongoose = require('mongoose');

const EmailTemplateSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true, trim: true },
        subjectTemplates: [{ type: String, trim: true }],
        bodyTemplates: [{ type: String }],
        companyName: { type: String, trim: true, default: '' },
        isDefault: { type: Boolean, default: false },
    },
    { timestamps: true }
);

module.exports = mongoose.model('EmailTemplate', EmailTemplateSchema);
