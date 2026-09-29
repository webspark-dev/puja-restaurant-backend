// ============================================
// backend/src/routes/order.js
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

// ============================================
// ⚠️ IMPORTANT: Specific routes BEFORE dynamic routes
// ============================================

// ---- Specific GET routes (আগে থাকতে হবে) ----
router.get('/customer-history', orderController.getCustomerHistory);
router.get('/live', orderController.getLiveOrders);

// ---- Customer routes ----
router.post('/', orderController.createOrder);

// ---- Dynamic route (একদম শেষে) ----
router.get('/:orderId', orderController.getOrder);

// ---- Admin routes ----
router.patch('/:orderId/status', adminAuth, orderController.updateOrderStatus);
router.patch('/:orderId/settle-cash', adminAuth, orderController.settleCash);
router.patch('/:orderId/print-bill', adminAuth, orderController.printBill);

module.exports = router;