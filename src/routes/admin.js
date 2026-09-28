const router = require('express').Router();
const billController = require('../controllers/billController');
const adminController = require('../controllers/adminController');
const orderController = require('../controllers/orderController');
const { authenticate, authorize } = require('../middleware/auth');

// ============================================
// Ordering ON/OFF
// ============================================
router.post('/ordering/toggle',
  authenticate, authorize('owner', 'manager'),
  adminController.toggleOrdering
);

router.get('/ordering/status',
  authenticate, authorize('owner', 'manager'),
  adminController.getOrderingStatus
);

router.post('/ordering/schedule',
  authenticate, authorize('owner', 'manager'),
  adminController.updateSchedule
);

// ============================================
// Dashboard
// ============================================
router.get('/dashboard/stats',
  authenticate, authorize('owner', 'manager'),
  adminController.getDashboardStats
);

router.get('/dashboard/daybook',
  authenticate, authorize('owner', 'manager'),
  adminController.getDayBook
);

router.get('/orders/history',
  authenticate, authorize('owner', 'manager'),
  adminController.getOrderHistory
);

router.get('/orders/live',
  authenticate, authorize('owner', 'manager'),
  orderController.getLiveOrders
);

router.get('/orders/cash-pending',
  authenticate, authorize('owner', 'manager', 'cashier'),
  orderController.getCashPending
);

// ============================================
// Kitchen
// ============================================
router.get('/kitchen/orders',
  authenticate, authorize('owner', 'manager', 'kitchen'),
  adminController.getKitchenOrders
);

// ============================================
// Cash Confirm
// ============================================
router.post('/orders/:id/confirm-cash',
  authenticate, authorize('owner', 'manager', 'cashier'),
  orderController.confirmCash
);

// ============================================
// Order Status Update
// ============================================
router.patch('/orders/:id/status',
  authenticate, authorize('owner', 'manager', 'kitchen'),
  orderController.updateStatus
);

// ============================================
// Bill
// ============================================
router.get('/orders/:orderId/bill',
  authenticate, authorize('owner', 'manager', 'cashier'),
  billController.adminDownloadBill
);

router.get('/orders/:orderId/bill-data',
  authenticate, authorize('owner', 'manager', 'cashier'),
  billController.adminGetBillData
);

module.exports = router;