const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const { getOverview } = require('../controllers/dashboardController');

const router = express.Router();
router.use(protect);
router.get('/overview', getOverview);

module.exports = router;
