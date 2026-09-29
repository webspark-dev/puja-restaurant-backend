// ============================================
// backend/controllers/orderController.js
// Column names: restaurant_id, token, subtotal, gst, total
// ============================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// Helper: Generate Token
// ============================================
async function generateToken(restaurant_id, orderType) {
  const today = new Date().toISOString().split('T')[0];
  const prefix = orderType === 'takeaway' ? 'T' : 'D';

  const { data: existing } = await supabase
    .from('orders')
    .select('token')
    .eq('restaurant_id', restaurant_id)
    .eq('order_type', orderType)
    .gte('created_at', today + 'T00:00:00')
    .order('created_at', { ascending: false })
    .limit(1);

  let nextNum = 1;
  if (existing && existing.length > 0 && existing[0].token) {
    const match = existing[0].token.match(/\d+/);
    if (match) nextNum = parseInt(match[0]) + 1;
  }

  return `${prefix}${String(nextNum).padStart(3, '0')}`;
}

// ============================================
// Helper: Generate Order Number
// ============================================
function generateOrderNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `ORD-${date}-${rand}`;
}

// ============================================
// CREATE ORDER
// ============================================
exports.createOrder = async (req, res) => {
  try {
    const {
      restaurant_id,
      customer_name,
      customer_mobile,
      items,
      total_amount,
      payment_method,
      order_type = 'dinein',
      notes = ''
    } = req.body;

    // Validate
    const missing = [];
    if (!restaurant_id) missing.push('restaurant_id');
    if (!customer_name) missing.push('customer_name');
    if (!customer_mobile) missing.push('customer_mobile');
    if (!items || items.length === 0) missing.push('items');
    if (!total_amount) missing.push('total_amount');
    if (!payment_method) missing.push('payment_method');

    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing: ${missing.join(', ')}`,
        missing
      });
    }

    const token = await generateToken(restaurant_id, order_type);
    const orderNumber = generateOrderNumber();
    const isOnline = payment_method !== 'cash';

    // Compute amounts
    const subtotal = Number(total_amount);
    const gst = Number((subtotal * 0.05).toFixed(2)); // 5% GST
    const total = Number((subtotal + gst).toFixed(2));

    const { data: order, error } = await supabase
      .from('orders')
      .insert([{
        restaurant_id: restaurant_id,      // ✅ camelCase
        order_number: orderNumber,
        token: token,                      // ✅ token (token_number নয়)
        customer_name,
        customer_mobile,
        items,
        subtotal,                          // ✅
        gst,                               // ✅
        total,                             // ✅ total_amount নয়
        payment_method,
        order_type,
        notes,
        status: isOnline ? 'placed' : 'awaiting_payment',
        is_cash_settled: isOnline ? true : false,
        tracking_enabled: isOnline ? true : false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;

    const io = req.app.get('io');
    if (io) {
      io.to(`restaurant_${restaurant_id}`).emit('newOrder', order);
    }

    res.status(201).json({
      success: true,
      order,
      token: token,
      order_number: orderNumber
    });

  } catch (error) {
    console.error('createOrder error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// GET ORDER
// ============================================
exports.getOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({
      success: true,
      order,
      items: order.items || []
    });

  } catch (error) {
    console.error('getOrder error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// GET LIVE ORDERS
// ============================================
exports.getLiveOrders = async (req, res) => {
  try {
    const { restaurant_id } = req.query;

    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id required' });
    }

    const today = new Date().toISOString().split('T')[0];

    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .gte('created_at', today + 'T00:00:00')
      .in('status', ['awaiting_payment', 'placed', 'confirmed', 'preparing', 'ready'])
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ success: true, orders: orders || [] });

  } catch (error) {
    console.error('getLiveOrders error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// STEP 2: CONFIRM CASH
// ============================================
exports.settleCash = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.payment_method !== 'cash') {
      return res.status(400).json({ error: 'Only for cash payments' });
    }

    if (order.is_cash_settled) {
      return res.status(400).json({ error: 'Cash already confirmed' });
    }

    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({
        is_cash_settled: true,
        status: 'placed',
        cash_settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    const io = req.app.get('io');
    if (io) {
      io.to(`order_${orderId}`).emit('orderUpdate', {
        orderId,
        is_cash_settled: true,
        status: 'placed',
        message: 'Payment confirmed.'
      });
    }

    res.json({
      success: true,
      message: 'Cash confirmed.',
      order: updated
    });

  } catch (error) {
    console.error('settleCash error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// STEP 3: PRINT BILL → Tracking ON
// ============================================
exports.printBill = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.payment_method === 'cash' && !order.is_cash_settled) {
      return res.status(400).json({
        error: 'Confirm cash payment first',
        code: 'CASH_NOT_CONFIRMED'
      });
    }

    if (order.tracking_enabled) {
      return res.status(400).json({ error: 'Bill already printed' });
    }

    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({
        tracking_enabled: true,
        bill_printed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    const io = req.app.get('io');
    if (io) {
      io.to(`order_${orderId}`).emit('orderUpdate', {
        orderId,
        tracking_enabled: true,
        message: 'Bill printed. Tracking enabled!'
      });
    }

    res.json({
      success: true,
      message: 'Bill printed.',
      order: updated
    });

  } catch (error) {
    console.error('printBill error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// UPDATE STATUS
// ============================================
exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = ['placed', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (
      order.payment_method === 'cash' &&
      !order.tracking_enabled &&
      ['preparing', 'ready', 'completed'].includes(status)
    ) {
      return res.status(400).json({
        error: 'Print bill first',
        code: 'BILL_NOT_PRINTED'
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    const io = req.app.get('io');
    if (io) {
      io.to(`order_${orderId}`).emit('orderUpdate', {
        orderId,
        status,
        updated_at: updated.updated_at
      });
    }

    res.json({ success: true, order: updated });

  } catch (error) {
    console.error('updateOrderStatus error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Aliases
exports.confirmCash = async (req, res) => exports.settleCash(req, res);
exports.updateStatus = async (req, res) => exports.updateOrderStatus(req, res);

// ============================================
// GET CASH PENDING
// ============================================
exports.getCashPending = async (req, res) => {
  try {
    const { restaurant_id } = req.query;
    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id required' });
    }

    const today = new Date().toISOString().split('T')[0];
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('payment_method', 'cash')
      .eq('is_cash_settled', false)
      .gte('created_at', today + 'T00:00:00')
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ success: true, orders: orders || [] });
  } catch (error) {
    console.error('getCashPending error:', error);
    res.status(500).json({ error: error.message });
  }
};
