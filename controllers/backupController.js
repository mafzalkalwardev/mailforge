const EmailTemplate = require('../models/EmailTemplate');
const SuppressedEmail = require('../models/SuppressedEmail');
const BulkJob = require('../models/BulkJob');

const exportBackup = async (req, res) => {
    try {
        const [templates, suppression, bulkJobs] = await Promise.all([
            EmailTemplate.find({ user: req.user._id }).select('-__v'),
            SuppressedEmail.find({ user: req.user._id }).select('email reason note createdAt'),
            BulkJob.find({ user: req.user._id }).select('fileName stats completedAt isPartial').sort({ completedAt: -1 }).limit(100),
        ]);

        res.json({
            exportedAt: new Date().toISOString(),
            templates,
            suppression,
            bulkJobIndex: bulkJobs,
            note: 'Sender passwords are not included. Re-import suppression via /api/suppression/import.',
        });
    } catch (error) {
        res.status(500).json({ message: 'Backup export failed', error: error.message });
    }
};

module.exports = { exportBackup };
