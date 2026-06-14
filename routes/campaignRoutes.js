const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const {
    listCampaigns,
    getCampaign,
    createFromBulkJob,
    updateCampaign,
    startCampaignHandler,
    pauseCampaignHandler,
    deleteCampaign,
    getCampaignAnalytics,
    getCampaignQueue,
    retryFailedRecipients,
} = require('../controllers/campaignController');

const router = express.Router();
router.use(protect);

router.get('/', listCampaigns);
router.post('/from-bulk-job', createFromBulkJob);
router.get('/:id/queue', getCampaignQueue);
router.get('/:id/analytics', getCampaignAnalytics);
router.post('/:id/retry-failed', retryFailedRecipients);
router.get('/:id', getCampaign);
router.put('/:id', updateCampaign);
router.post('/:id/start', startCampaignHandler);
router.post('/:id/pause', pauseCampaignHandler);
router.delete('/:id', deleteCampaign);

module.exports = router;
