const router = require('express').Router();
const reportController = require('../controllers/reportController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require admin auth
router.use(authenticate, authorize('owner', 'manager'));

router.get('/sales', reportController.getSalesReport);
router.get('/top-items', reportController.getTopItems);
router.get('/hourly', reportController.getHourlySales);
router.get('/payment-breakdown', reportController.getPaymentBreakdown);
router.get('/rolling-30', reportController.get30DayRolling);

module.exports = router;