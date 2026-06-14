const express = require('express');
const multer = require('multer');
const os = require('os');
const { protect } = require('../middlewares/authMiddleware');
const {
    listSenders,
    createSender,
    updateSender,
    deleteSender,
    testSender,
    sendTestEmail,
    bulkImportSenders,
    checkSenderDns,
} = require('../controllers/senderController');

const router = express.Router();
const upload = multer({ dest: process.env.VERCEL ? os.tmpdir() : 'uploads/' });

router.use(protect);

router.get('/', listSenders);
router.post('/import', upload.single('file'), bulkImportSenders);
router.post('/', createSender);
router.post('/:id/test', testSender);
router.post('/:id/check-dns', checkSenderDns);
router.post('/:id/send-test', sendTestEmail);
router.put('/:id', updateSender);
router.delete('/:id', deleteSender);

module.exports = router;
