const router = require('express').Router();
const orderController = require('../controllers/orderController');
const { authenticateCustomer } = require('../middleware/customerAuth');
const { authenticate, authorize } = require('../middleware/auth');

// ============================================
// CUSTOMER ROUTES
// ============================================
router.post('/', authenticateCustomer, orderController.createOrder);
router.get('/:id', authenticateCustomer, orderController.getOrder);

// ============================================
// ADMIN ROUTES
// ============================================
router.post('/:id/confirm-cash',
  authenticate,
  authorize('owner', 'manager', 'cashier'),
  orderController.confirmCash
);

router.patch('/:id/status',
  authenticate,
  authorize('owner', 'manager', 'kitchen'),
  orderController.updateStatus
);

router.get('/admin/live',
  authenticate,
  authorize('owner', 'manager'),
  orderController.getLiveOrders
);

router.get('/admin/cash-pending',
  authenticate,
  authorize('owner', 'manager', 'cashier'),
  orderController.getCashPending
);

module.exports = router;