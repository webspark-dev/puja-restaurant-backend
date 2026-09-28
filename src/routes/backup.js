const router = require('express').Router();
const backupController = require('../controllers/backupController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('owner', 'manager'));

// Download Excel backup
router.get('/export', backupController.exportOrders);

// Backup stats
router.get('/info', backupController.backupInfo);

module.exports = router;