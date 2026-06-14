const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const {
    listSuppressed,
    addToSuppression,
    bulkImportSuppression,
    removeFromSuppression,
    publicUnsubscribe,
} = require('../controllers/suppressionController');

const router = express.Router();

router.post('/unsubscribe', publicUnsubscribe);

router.use(protect);
router.get('/', listSuppressed);
router.post('/', addToSuppression);
router.post('/import', bulkImportSuppression);
router.delete('/:id', removeFromSuppression);

module.exports = router;
