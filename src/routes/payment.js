const router = require('express').Router();
const paymentController = require('../controllers/paymentController');
const { authenticateCustomer } = require('../middleware/customerAuth');

// Customer authenticated
router.post('/initiate-upi', authenticateCustomer, paymentController.initiateUPI);
router.get('/status/:order_id', authenticateCustomer, paymentController.checkStatus);

// Public — Mock + Success
router.get('/mock-page', paymentController.mockPaymentPage);
router.post('/mock-confirm', paymentController.mockConfirm);
router.get('/success-page', paymentController.successPage);

// Public — Bill
router.get('/bill-view', paymentController.publicBillView);
router.get('/bill-public', paymentController.publicBillPDF);

module.exports = router;