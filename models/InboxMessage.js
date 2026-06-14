const mongoose = require('mongoose');

const InboxMessageSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        senderAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'SenderAccount', required: true },
        campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
        uid: { type: String, required: true },
        messageId: { type: String, trim: true },
        inReplyTo: { type: String, trim: true },
        from: { type: String, trim: true },
        to: { type: String, trim: true },
        subject: { type: String, trim: true },
        bodyPreview: { type: String, default: '' },
        body: { type: String, default: '' },
        isRead: { type: Boolean, default: false },
        isStarred: { type: Boolean, default: false },
        isImportant: { type: Boolean, default: false },
        isBounce: { type: Boolean, default: false },
        leadTag: {
            type: String,
            enum: ['none', 'lead', 'not_interested', 'follow_up'],
            default: 'none',
        },
        threadKey: { type: String, trim: true, index: true },
        receivedAt: { type: Date, required: true },
        syncedAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

InboxMessageSchema.index({ user: 1, senderAccount: 1, uid: 1 }, { unique: true });
InboxMessageSchema.index({ user: 1, receivedAt: -1 });
InboxMessageSchema.index({ user: 1, campaign: 1 });
InboxMessageSchema.index({ user: 1, isRead: 1 });
InboxMessageSchema.index({ user: 1, isStarred: 1 });
InboxMessageSchema.index({ user: 1, isImportant: 1 });

module.exports = mongoose.model('InboxMessage', InboxMessageSchema);
