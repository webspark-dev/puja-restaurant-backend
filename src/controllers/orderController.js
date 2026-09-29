// ============================================
// backend/controllers/orderController.js
// Full Order Controller with Cash Settlement
// ============================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// Helper: Generate Token Number
// ============================================
async function generateTokenNumber(restaurantId, orderType) {
  const today = new Date().toISOString().split('T')[0];
  const prefix = orderType === 'takeaway' ? 'T' : 'D';

  const { data: existing } = await supabase
    .from('orders')
    .select('token_number')
    .eq('restaurant_id', restaurantId)
    .eq('order_type', orderType)
    .gte('created_at', today + 'T00:00:00')
    .order('created_at', { ascending: false })
    .limit(1);

  let nextNum = 1;
  if (existing && existing.length > 0 && existing[0].token_number) {
    const match = existing[0].token_number.match(/\d+/);
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
// CREATE ORDER — Customer places order
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

    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id required' });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'No items in order' });
    }

    // Generate token & order number
    const tokenNumber = await generateTokenNumber(restaurant_id, order_type);
    const orderNumber = generateOrderNumber();

    // Insert order
    const { data: order, error } = await supabase
      .from('orders')
      .insert([{
        restaurant_id,
        order_number: orderNumber,
        token_number: tokenNumber,
        customer_name,
        customer_mobile,
        items,
        total_amount,
        payment_method,
        order_type,
        notes,
        status: 'placed',
        is_cash_settled: false,   // 🔑 Cash trigger flag
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;

    // Real-time notify admin
    const io = req.app.get('io');
    if (io) {
      io.to(`restaurant_${restaurant_id}`).emit('newOrder', order);
    }

    res.status(201).json({
      success: true,
      order,
      token_number: tokenNumber,
      order_number: orderNumber
    });

  } catch (error) {
    console.error('createOrder error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// GET ORDER — Customer fetches order details
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

    res.json({ success: true, order });

  } catch (error) {
    console.error('getOrder error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// GET LIVE ORDERS — Admin dashboard
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
      .in('status', ['placed', 'confirmed', 'preparing', 'ready'])
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ success: true, orders: orders || [] });

  } catch (error) {
    console.error('getLiveOrders error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// 🚨 NEW: SETTLE CASH — Admin marks cash + bill printed
// ============================================
exports.settleCash = async (req, res) => {
  try {
    const { orderId } = req.params;

    // Fetch order
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Validate: only cash orders
    if (order.payment_method !== 'cash') {
      return res.status(400).json({
        error: 'This endpoint is only for cash payments'
      });
    }

    // Validate: not already settled
    if (order.is_cash_settled) {
      return res.status(400).json({
        error: 'Cash already settled for this order'
      });
    }

    // Update: mark settled + move to preparing
    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({
        is_cash_settled: true,
        status: 'preparing',
        cash_settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Real-time notify customer
    const io = req.app.get('io');
    if (io) {
      io.to(`order_${orderId}`).emit('orderUpdate', {
        orderId,
        status: 'preparing',
        is_cash_settled: true,
        updated_at: updated.updated_at,
        message: 'Payment received. Your food is being prepared!'
      });
    }

    res.json({
      success: true,
      message: 'Cash settled. Kitchen notified.',
      order: updated
    });

  } catch (error) {
    console.error('settleCash error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// UPDATE ORDER STATUS — with cash validation
// ============================================
exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = ['placed', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Fetch order
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // 🚨 CASH VALIDATION: Must settle cash before preparing
    if (
      order.payment_method === 'cash' &&
      !order.is_cash_settled &&
      ['preparing', 'ready', 'completed'].includes(status)
    ) {
      return res.status(400).json({
        error: 'Cash not settled. Please confirm cash received & print bill first.',
        code: 'CASH_NOT_SETTLED'
      });
    }

    // Update status
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

    // Real-time notify
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