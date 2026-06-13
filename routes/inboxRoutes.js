const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const {
    listMessages,
    getMessage,
    markRead,
    syncInbox,
    inboxStats,
    listSenderAccounts,
} = require('../controllers/inboxController');

const router = express.Router();
router.use(protect);

router.get('/stats', inboxStats);
router.get('/accounts', listSenderAccounts);
router.post('/sync', syncInbox);
router.get('/', listMessages);
router.get('/:id', getMessage);
router.post('/:id/read', markRead);

module.exports = router;
