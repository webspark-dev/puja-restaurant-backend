const router = require('express').Router();
const {
  sendOtp,
  verifyOtp,
  me
} = require('../controllers/customerController');
const { authenticateCustomer } = require('../middleware/customerAuth');

// Public
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);

// Protected (customer token লাগবে)
router.get('/me', authenticateCustomer, me);

module.exports = router;