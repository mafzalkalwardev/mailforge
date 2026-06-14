const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const { exportBackup } = require('../controllers/backupController');

const router = express.Router();
router.use(protect);
router.get('/export', exportBackup);

module.exports = router;
