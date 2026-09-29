const supabase = require('../config/database');
const phonePe = require('../services/phonePeService');
const billService = require('../services/billService');

async function getPublicBillAccessError(orderId) {
  const { data: order, error } = await supabase
    .from('orders')
    .select('payment_method')
    .eq('id', orderId)
    .maybeSingle();

  if (error) throw error;
  if (!order) return { status: 404, message: 'Order not found' };
  if (order.payment_method === 'cash') {
    return { status: 403, message: 'Cash bills are provided by restaurant staff' };
  }

  return null;
}

// ============================================
// UPI Payment Initiate
// ============================================
exports.initiateUPI = async (req, res) => {
  try {
    const { order_id } = req.body;
    const customer = req.customer;

    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .eq('customer_mobile', customer.mobile)
      .single();

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.payment_method !== 'upi') {
      return res.status(400).json({ error: 'Not a UPI order' });
    }
    if (order.payment_status === 'PAID') {
      return res.status(400).json({ error: 'Already paid' });
    }

    const result = await phonePe.createPayment({
      orderId: order.order_number,
      amount: order.total,
      callbackUrl: `${process.env.BACKEND_URL}/api/payment/webhook`,
      redirectUrl: `${process.env.FRONTEND_URL}/payment/callback`
    });

    await supabase.from('payments').insert({
      order_id: order.id,
      gateway: 'phonepe',
      gateway_order_id: order.order_number,
      amount: order.total,
      status: 'INITIATED'
    });

    res.json({
      success: true,
      payment_url: result.redirectUrl,
      token: order.token,
      order_id: order.id
    });

  } catch (err) {
    console.error('UPI init error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Helper: Payment Success + WebSocket
// ============================================
async function onPaymentSuccess(orderNumber, paymentId, io) {
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('order_number', orderNumber)
    .single();

  if (!order) throw new Error('Order not found');

  if (order.payment_status === 'PAID') {
    return { order, billNo: order.bill_no, alreadyPaid: true };
  }

  const billNo = 'INV-' + Date.now().toString().slice(-5);
  const billPdfUrl = `/api/payment/bill-public?orderId=${order.id}`;

  await supabase
    .from('orders')
    .update({
      payment_status: 'PAID',
      payment_id: paymentId,
      status: 'CONFIRMED',
      bill_no: billNo,
      bill_pdf_url: billPdfUrl,
      updated_at: new Date().toISOString()
    })
    .eq('id', order.id);

  await supabase
    .from('payments')
    .update({
      status: 'SUCCESS',
      gateway_payment_id: paymentId,
      webhook_verified: true
    })
    .eq('order_id', order.id);

  await supabase.from('order_status_history').insert({
    order_id: order.id,
    status: 'CONFIRMED',
    note: 'UPI payment auto-verified'
  });

  if (io) {
    io.to('admin').emit('order:confirmed', {
      order_id: order.id,
      token: order.token,
      bill_no: billNo,
      payment_method: 'UPI',
      payment_status: 'PAID',
      status: 'CONFIRMED',
      total: order.total,
      timestamp: new Date().toISOString()
    });

    io.to('kitchen').emit('order:confirmed', {
      order_id: order.id,
      token: order.token,
      order_type: order.order_type
    });

    console.log(`🔔 WS: UPI confirmed ${order.token}`);
  }

  console.log(`✅ UPI Auto-Verified: ${order.token} | Bill: ${billNo}`);

  return { order, billNo, alreadyPaid: false };
}

// ============================================
// Mock Payment Page (Dev)
// ============================================
exports.mockPaymentPage = async (req, res) => {
  const { orderId, amount } = req.query;

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Mock UPI Payment</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, sans-serif; background: #f5f5f7; min-height: 100vh; padding: 20px; display: flex; align-items: center; justify-content: center; }
        .card { background: white; border-radius: 16px; padding: 30px; max-width: 380px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,0.1); text-align: center; }
        .logo { font-size: 40px; margin-bottom: 10px; }
        h1 { font-size: 20px; margin: 10px 0; }
        .amount { font-size: 36px; font-weight: 800; color: #5f259f; margin: 20px 0; }
        .order { color: #666; font-size: 14px; margin-bottom: 30px; }
        .buttons { display: flex; gap: 10px; }
        button { flex: 1; padding: 14px; border: none; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; }
        .success { background: #16a34a; color: white; }
        .fail { background: #f0f0f0; color: #333; }
        .note { background: #fff7ed; border-left: 4px solid #f59e0b; padding: 10px; border-radius: 8px; font-size: 12px; color: #92400e; text-align: left; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">💳</div>
        <h1>Mock UPI Payment</h1>
        <div class="amount">₹${amount}</div>
        <div class="order">Order: ${orderId}</div>
        <div class="buttons">
          <button class="fail" onclick="handlePayment('FAILED')">Fail</button>
          <button class="success" onclick="handlePayment('SUCCESS')">Pay ₹${amount}</button>
        </div>
        <div class="note">
          ⚠️ <strong>Development Mode:</strong> Production-এ real PhonePe page আসবে।
        </div>
      </div>
      <script>
        async function handlePayment(status) {
          try {
            const res = await fetch('/api/payment/mock-confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: '${orderId}', status })
            });
            const data = await res.json();
            if (data.success && status === 'SUCCESS') {
              window.location.href = 'http://localhost:5173/success?orderId=' + encodeURIComponent(data.order_id) + '&token=' + encodeURIComponent(data.token) + '&bill=' + encodeURIComponent(data.bill_no || '');
            } else {
              document.querySelector('.card').innerHTML = '<div class="logo">❌</div><h1>Payment Failed</h1>';
            }
          } catch (e) {
            alert('Error: ' + e.message);
          }
        }
      </script>
    </body>
    </html>
  `);
};

// ============================================
// Mock Confirm
// ============================================
exports.mockConfirm = async (req, res) => {
  try {
    const { orderId, status } = req.body;

    if (status !== 'SUCCESS') {
      return res.json({ success: false, message: 'Payment failed' });
    }

    const io = req.app.get('io');
    const result = await onPaymentSuccess(orderId, 'MOCK_' + Date.now(), io);

    res.json({
      success: true,
      order_id: result.order.id,
      token: result.order.token,
      bill_no: result.billNo
    });

  } catch (err) {
    console.error('Mock confirm error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Legacy Success Page (Backend Direct URL)
// ============================================
exports.successPage = async (req, res) => {
  const { orderId, token, bill } = req.query;
  // Redirect to frontend instead
  res.redirect(`http://localhost:5173/success?orderId=${orderId}&token=${token}&bill=${bill}`);
};

// ============================================
// Public Bill View (HTML)
// ============================================
exports.publicBillView = async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) return res.status(400).send('orderId required');

    const accessError = await getPublicBillAccessError(orderId);
    if (accessError) return res.status(accessError.status).send(accessError.message);

    const html = await billService.generateBillHTML(orderId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (err) {
    console.error('Bill view error:', err);
    res.status(500).send('Error: ' + err.message);
  }
};

// ============================================
// Public Bill PDF (Download)
// ============================================
exports.publicBillPDF = async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    const accessError = await getPublicBillAccessError(orderId);
    if (accessError) return res.status(accessError.status).json({ error: accessError.message });

    const pdfBuffer = await billService.generateBillPDF(orderId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Bill_${orderId}.pdf"`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('Public bill error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Real Webhook
// ============================================
exports.webhook = async (req, res) => {
  try {
    const xVerify = req.headers['x-verify'];
    const rawBody = req.rawBody;

    if (!phonePe.verifyWebhook(rawBody, xVerify)) {
      return res.status(401).send('Unauthorized');
    }

    const body = JSON.parse(rawBody);
    const decoded = JSON.parse(Buffer.from(body.response, 'base64').toString());
    const { merchantTransactionId, transactionId, state } = decoded.data;

    if (state === 'COMPLETED') {
      const io = req.app.get('io');
      await onPaymentSuccess(merchantTransactionId, transactionId, io);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).send('OK');
  }
};

// ============================================
// Status Check
// ============================================
exports.checkStatus = async (req, res) => {
  try {
    const { order_id } = req.params;
    const customer = req.customer;

    const { data: order } = await supabase
      .from('orders')
      .select('id, token, payment_status, status, bill_no, bill_pdf_url')
      .eq('id', order_id)
      .eq('customer_mobile', customer.mobile)
      .single();

    if (!order) return res.status(404).json({ error: 'Not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};