// ============================================
// backend/routes/order.js
// ============================================

const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// Optional auth middleware
let adminAuth = (req, res, next) => next();
try {
  const authMiddleware = require('../middleware/auth');
  if (authMiddleware && authMiddleware.adminAuth) {
    adminAuth = authMiddleware.adminAuth;
  }
} catch (e) {
  console.warn('adminAuth middleware not found, using passthrough');
}

// ---- Customer routes ----
router.post('/', orderController.createOrder);
router.get('/customer-history', orderController.getCustomerHistory);
router.get('/live', orderController.getLiveOrders);
router.get('/:orderId', orderController.getOrder);

// ---- Admin routes ----
router.patch('/:orderId/status', adminAuth, orderController.updateOrderStatus);
router.patch('/:orderId/settle-cash', adminAuth, orderController.settleCash);
router.patch('/:orderId/print-bill', adminAuth, orderController.printBill);

module.exports = router;