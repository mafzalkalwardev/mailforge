const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const {
    listTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
} = require('../controllers/templateController');

const router = express.Router();
router.use(protect);

router.get('/', listTemplates);
router.post('/', createTemplate);
router.put('/:id', updateTemplate);
router.delete('/:id', deleteTemplate);

module.exports = router;
