const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { protect } = require('../middlewares/authMiddleware');

router.get('/', protect, getSettings);
router.put('/', protect, updateSettings);

module.exports = router;
