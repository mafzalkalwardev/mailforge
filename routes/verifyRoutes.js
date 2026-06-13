const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const {
    verifySingleEmail,
    verifyBulkEmails,
    uploadBulkFile,
    getEngineHealth,
} = require('../controllers/verifyController');
const {
    startJobFromUpload,
    getActiveJob,
    getJobById,
    cancelJob,
    pauseJob,
    resumeJob,
    listRecentJobs,
} = require('../controllers/verifyJobController');
const { protect } = require('../middlewares/authMiddleware');

const upload = multer({ dest: process.env.VERCEL ? os.tmpdir() : 'uploads/' });

router.get('/health', protect, getEngineHealth);
router.get('/engine-status', getEngineHealth);
router.post('/single', protect, verifySingleEmail);
router.post('/bulk', protect, verifyBulkEmails);
router.post('/upload-bulk', protect, upload.single('file'), uploadBulkFile);

router.get('/jobs/active', protect, getActiveJob);
router.get('/jobs/recent', protect, listRecentJobs);
router.post('/jobs', protect, upload.single('file'), startJobFromUpload);
router.get('/jobs/:id', protect, getJobById);
router.post('/jobs/:id/cancel', protect, cancelJob);
router.post('/jobs/:id/pause', protect, pauseJob);
router.post('/jobs/:id/resume', protect, resumeJob);

module.exports = router;
