const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const {
    listMessages,
    getMessage,
    markRead,
    syncInbox,
    inboxStats,
} = require('../controllers/inboxController');

const router = express.Router();
router.use(protect);

router.get('/stats', inboxStats);
router.post('/sync', syncInbox);
router.get('/', listMessages);
router.get('/:id', getMessage);
router.post('/:id/read', markRead);

module.exports = router;
