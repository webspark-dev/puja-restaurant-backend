const router = require('express').Router();
const billController = require('../controllers/billController');
const { authenticateCustomer } = require('../middleware/customerAuth');

// Customer routes
router.get('/:orderId/pdf', authenticateCustomer, billController.downloadBillPDF);
router.get('/:orderId/data', authenticateCustomer, billController.getBillData);

module.exports = router;