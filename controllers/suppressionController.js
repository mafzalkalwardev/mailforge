const SuppressedEmail = require('../models/SuppressedEmail');
const { verifyUnsubscribeToken } = require('../utils/unsubscribeToken');
const { addSuppression } = require('../utils/suppressionService');

const listSuppressed = async (req, res) => {
    try {
        const { q, limit = 100, offset = 0, reason } = req.query;
        const filter = { user: req.user._id };
        if (q) filter.email = { $regex: q, $options: 'i' };
        if (reason) filter.reason = reason;

        const [items, total] = await Promise.all([
            SuppressedEmail.find(filter)
                .sort({ createdAt: -1 })
                .skip(Number(offset))
                .limit(Math.min(Number(limit), 500)),
            SuppressedEmail.countDocuments(filter),
        ]);
        res.json({ items, total });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching suppression list', error: error.message });
    }
};

const addToSuppression = async (req, res) => {
    try {
        const { email, reason, note } = req.body;
        if (!email) return res.status(400).json({ message: 'email is required' });
        const item = await addSuppression(req.user._id, email, reason || 'manual', note || '');
        res.status(201).json(item);
    } catch (error) {
        res.status(500).json({ message: 'Error adding to suppression list', error: error.message });
    }
};

const bulkImportSuppression = async (req, res) => {
    try {
        const { emails, reason } = req.body;
        if (!Array.isArray(emails) || !emails.length) {
            return res.status(400).json({ message: 'emails array is required' });
        }
        let added = 0;
        for (const raw of emails) {
            const item = await addSuppression(req.user._id, raw, reason || 'import');
            if (item) added += 1;
        }
        res.json({ added, total: emails.length });
    } catch (error) {
        res.status(500).json({ message: 'Error importing suppression list', error: error.message });
    }
};

const removeFromSuppression = async (req, res) => {
    try {
        const result = await SuppressedEmail.findOneAndDelete({
            _id: req.params.id,
            user: req.user._id,
        });
        if (!result) return res.status(404).json({ message: 'Entry not found' });
        res.json({ message: 'Removed from suppression list' });
    } catch (error) {
        res.status(500).json({ message: 'Error removing entry', error: error.message });
    }
};

const getSuppressionStats = async (req, res) => {
    try {
        const rows = await SuppressedEmail.aggregate([
            { $match: { user: req.user._id } },
            { $group: { _id: '$reason', count: { $sum: 1 } } },
        ]);
        const byReason = Object.fromEntries(rows.map(r => [r._id, r.count]));
        res.json({
            total: Object.values(byReason).reduce((a, b) => a + b, 0),
            byReason,
            bounces: byReason.bounce || 0,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching stats', error: error.message });
    }
};

const publicUnsubscribe = async (req, res) => {
    try {
        const { token } = req.body;
        const parsed = verifyUnsubscribeToken(token);
        if (!parsed) return res.status(400).json({ message: 'Invalid or expired unsubscribe link' });
        await addSuppression(parsed.userId, parsed.email, 'unsubscribe', 'Public unsubscribe link');
        res.json({ message: 'You have been unsubscribed', email: parsed.email });
    } catch (error) {
        res.status(500).json({ message: 'Unsubscribe failed', error: error.message });
    }
};

module.exports = {
    listSuppressed,
    addToSuppression,
    bulkImportSuppression,
    removeFromSuppression,
    publicUnsubscribe,
    getSuppressionStats,
};
