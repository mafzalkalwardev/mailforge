const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const {
    listSenders,
    createSender,
    updateSender,
    deleteSender,
    testSender,
} = require('../controllers/senderController');

const router = express.Router();
router.use(protect);

router.get('/', listSenders);
router.post('/', createSender);
router.put('/:id', updateSender);
router.delete('/:id', deleteSender);
router.post('/:id/test', testSender);

module.exports = router;
