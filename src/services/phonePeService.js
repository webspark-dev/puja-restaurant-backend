const crypto = require('crypto');

// ============================================
// MOCK UPI PAYMENT SERVICE
// Development-এর জন্য — real PhonePe credentials লাগবে না
// ============================================

const ENV = process.env.PHONEPE_ENV || 'sandbox';

// ============================================
// Payment Initiate (Mock)
// ============================================
exports.createPayment = async ({ orderId, amount, callbackUrl, redirectUrl }) => {
  console.log(`💳 [MOCK UPI] Payment for ${orderId}, amount: ₹${amount}`);

  const mockPaymentUrl = `${process.env.BACKEND_URL}/api/payment/mock-page?orderId=${orderId}&amount=${amount}`;

  return {
    redirectUrl: mockPaymentUrl,
    transactionId: orderId,
    success: true
  };
};

// ============================================
// Webhook Verify (Mock — সবসময় true)
// ============================================
exports.verifyWebhook = (rawBody, xVerifyHeader) => {
  return true;
};

// ============================================
// Status Check (Mock)
// ============================================
exports.checkStatus = async (merchantTransactionId) => {
  return {
    success: true,
    code: 'PAYMENT_SUCCESS',
    data: {
      merchantTransactionId,
      state: 'COMPLETED'
    }
  };
};