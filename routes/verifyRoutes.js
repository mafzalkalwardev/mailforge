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
const { protect } = require('../middlewares/authMiddleware');

const upload = multer({ dest: process.env.VERCEL ? os.tmpdir() : 'uploads/' });

router.get('/health', protect, getEngineHealth);
router.get('/engine-status', getEngineHealth);
router.post('/single', protect, verifySingleEmail);
router.post('/bulk', protect, verifyBulkEmails);
router.post('/upload-bulk', protect, upload.single('file'), uploadBulkFile);

module.exports = router;
