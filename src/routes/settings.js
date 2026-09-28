const router = require('express').Router();
const settingsController = require('../controllers/settingsController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require auth
router.use(authenticate);

// ============================================
// Profile (any logged user)
// ============================================
router.get('/profile', settingsController.getProfile);
router.put('/profile', settingsController.updateProfile);
router.post('/change-password', settingsController.changePassword);

// ============================================
// Restaurant (owner/manager only)
// ============================================
router.get('/', authorize('owner', 'manager'), settingsController.getSettings);
router.put('/restaurant', authorize('owner', 'manager'), settingsController.updateRestaurantInfo);
router.put('/business', authorize('owner', 'manager'), settingsController.updateBusinessSettings);

// ============================================
// Staff (owner only)
// ============================================
router.get('/staff', authorize('owner'), settingsController.getStaff);
router.post('/staff', authorize('owner'), settingsController.createStaff);
router.put('/staff/:id', authorize('owner'), settingsController.updateStaff);
router.delete('/staff/:id', authorize('owner'), settingsController.deleteStaff);

// ============================================
// Audit Log (owner only)
// ============================================
router.get('/audit-log', authorize('owner'), settingsController.getAuditLog);

module.exports = router;