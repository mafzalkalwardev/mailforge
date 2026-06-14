const express = require('express');
const router = express.Router();
const {
    getHistory,
    getStats,
    getBulkJobs,
    getBulkJobById,
    saveBulkJob,
    getBulkJobHygiene,
    exportBulkJobCsv,
    reverifyBulkJob,
    compareBulkJobs,
} = require('../controllers/historyController');
const { protect } = require('../middlewares/authMiddleware');

router.route('/').get(protect, getHistory);
router.route('/stats').get(protect, getStats);
router.route('/bulk-jobs').get(protect, getBulkJobs).post(protect, saveBulkJob);
router.route('/bulk-jobs/:id').get(protect, getBulkJobById);
router.get('/bulk-jobs/:id/hygiene', protect, getBulkJobHygiene);
router.get('/bulk-jobs/:id/export', protect, exportBulkJobCsv);
router.post('/bulk-jobs/compare', protect, compareBulkJobs);
router.post('/bulk-jobs/:id/reverify', protect, reverifyBulkJob);

module.exports = router;
