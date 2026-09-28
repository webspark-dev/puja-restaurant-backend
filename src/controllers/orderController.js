const supabase = require('../config/database');
const { generateToken, generateOrderNumber } = require('../services/tokenService');

// ============================================
// CUSTOMER: Order Create
// ============================================
exports.createOrder = async (req, res) => {
  try {
    const { restaurant_id, order_type, payment_method, items } = req.body;
    const customer = req.customer;

    if (!order_type || !['dinein', 'takeaway'].includes(order_type)) {
      return res.status(400).json({ error: 'Valid order_type required' });
    }
    if (!payment_method || !['upi', 'cash'].includes(payment_method)) {
      return res.status(400).json({ error: 'Valid payment_method required' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items required' });
    }

    const { data: settings } = await supabase
      .from('restaurant_settings')
      .select('ordering_enabled, gst_percent, cash_timeout_minutes, pause_message')
      .eq('restaurant_id', restaurant_id)
      .single();

    if (!settings?.ordering_enabled) {
      return res.status(400).json({
        error: 'Ordering paused',
        message: settings?.pause_message || 'Try again later'
      });
    }

    const itemIds = items.map(i => i.menu_item_id);
    const { data: menuItems } = await supabase
      .from('menu_items')
      .select('id, name, price, available')
      .in('id', itemIds)
      .eq('restaurant_id', restaurant_id);

    if (!menuItems || menuItems.length === 0) {
      return res.status(400).json({ error: 'Invalid items' });
    }

    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const menuItem = menuItems.find(m => m.id === item.menu_item_id);
      if (!menuItem) {
        return res.status(400).json({ error: `Item ${item.menu_item_id} not found` });
      }
      if (!menuItem.available) {
        return res.status(400).json({ error: `${menuItem.name} is not available` });
      }

      const qty = parseInt(item.quantity);
      if (qty < 1 || qty > 50) {
        return res.status(400).json({ error: 'Invalid quantity' });
      }

      const lineTotal = menuItem.price * qty;
      subtotal += lineTotal;

      orderItems.push({
        menu_item_id: menuItem.id,
        item_name: menuItem.name,
        price: menuItem.price,
        quantity: qty,
        total: lineTotal,
        variant_name: item.variant_name || null,
        variant_price: item.variant_price || null,
        spice_level: item.spice_level || null,
        addons: item.addons || [],
        addons_total: item.addons_total || 0,
        special_note: item.special_note || null
      });
    }

    const gst = Math.round((subtotal * (settings.gst_percent || 5)) / 100);
    const total = subtotal + gst;

    const token = await generateToken(restaurant_id, order_type);
    const orderNumber = await generateOrderNumber(restaurant_id);

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        restaurant_id,
        order_number: orderNumber,
        token,
        customer_name: customer.name,
        customer_mobile: customer.mobile,
        order_type,
        subtotal,
        gst,
        total,
        payment_method,
        payment_status: 'PENDING',
        status: 'PENDING_PAYMENT'
      })
      .select()
      .single();

    if (orderErr) throw orderErr;

    await supabase.from('order_items').insert(
      orderItems.map(oi => ({ ...oi, order_id: order.id }))
    );

    await supabase.from('order_status_history').insert({
      order_id: order.id,
      status: 'PENDING_PAYMENT',
      note: `Order created via ${payment_method}`
    });

    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('order:new', {
        order_id: order.id,
        token: order.token,
        order_number: order.order_number,
        order_type: order.order_type,
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        total: order.total,
        customer_name: customer.name,
        customer_mobile: customer.mobile,
        created_at: order.created_at
      });

      console.log(`🔔 WS: New order ${order.token} → admin`);
    }

    res.json({
      success: true,
      order: {
        id: order.id,
        order_number: order.order_number,
        token: order.token,
        subtotal: order.subtotal,
        gst: order.gst,
        total: order.total,
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        status: order.status,
        order_type: order.order_type,
        created_at: order.created_at
      },
      cash_timeout_minutes: settings.cash_timeout_minutes || 5
    });

  } catch (err) {
    console.error('Order create error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// CUSTOMER: Order Details
// ============================================
exports.getOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = req.customer;

    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .eq('customer_mobile', customer.mobile)
      .single();

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', id);

    const { data: history } = await supabase
      .from('order_status_history')
      .select('*')
      .eq('order_id', id)
      .order('created_at');

    res.json({
      success: true,
      order,
      items,
      history
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Cash Confirm
// ============================================
exports.confirmCash = async (req, res) => {
  try {
    const { id } = req.params;
    const { cash_received } = req.body;
    const user = req.user;

    console.log(`\n💰 [confirmCash] orderId=${id}, received=${cash_received}`);

    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_method !== 'cash') {
      return res.status(400).json({ error: 'Not a cash order' });
    }
    if (order.payment_status === 'PAID') {
      return res.status(400).json({ error: 'Already paid' });
    }
    if (order.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Order cancelled (timeout)' });
    }

    const orderTotal = parseFloat(order.total);
    const received = cash_received ? parseFloat(cash_received) : orderTotal;

    if (received < orderTotal) {
      return res.status(400).json({
        error: 'Cash received is less than total',
        total: orderTotal,
        received: received,
        short: (orderTotal - received).toFixed(2)
      });
    }

    const change = received - orderTotal;

    const { data: cashierUser } = await supabase
      .from('users')
      .select('name')
      .eq('id', user.id)
      .single();

    const billNo = 'INV-' + Date.now().toString().slice(-5);

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({
        payment_status: 'PAID',
        status: 'CONFIRMED',
        cash_received: received,
        change_returned: change,
        cashier_name: cashierUser?.name || 'Admin',
        bill_no: billNo,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select();

    if (updateErr) throw updateErr;
    if (!updated || updated.length === 0) {
      return res.status(404).json({ error: 'Update failed' });
    }

    await supabase.from('payments').insert({
      order_id: id,
      gateway: 'cash',
      amount: order.total,
      status: 'SUCCESS',
      webhook_verified: true
    });

    await supabase.from('order_status_history').insert({
      order_id: id,
      status: 'CONFIRMED',
      note: `Cash received: Rs.${received.toFixed(2)}, Change: Rs.${change.toFixed(2)}`,
      changed_by: user.id
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`order:${id}`).emit('order:confirmed', {
        order_id: id,
        token: order.token,
        bill_no: billNo,
        status: 'CONFIRMED',
        payment_status: 'PAID',
        cash_received: received,
        change_returned: change,
        timestamp: new Date().toISOString()
      });

      io.to('admin').emit('order:confirmed', {
        order_id: id,
        token: order.token,
        status: 'CONFIRMED'
      });

      console.log(`🔔 WS: Cash confirmed ${order.token}`);
    }

    res.json({
      success: true,
      token: order.token,
      bill_no: billNo,
      total: orderTotal.toFixed(2),
      cash_received: received.toFixed(2),
      change_returned: change.toFixed(2),
      cashier_name: cashierUser?.name || 'Admin',
      message: 'Cash payment confirmed'
    });

  } catch (err) {
    console.error('Cash confirm error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Update Status
// ============================================
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;
    const user = req.user;

    console.log(`\n🔄 [updateStatus] orderId=${id}, status=${status}`);

    const validStatuses = ['PREPARING', 'READY', 'COMPLETED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, payment_status, token, status')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.payment_status !== 'PAID') {
      return res.status(400).json({
        error: 'Payment not confirmed yet',
        message: 'Cannot update kitchen status before payment'
      });
    }

    const flow = { CONFIRMED: 0, PREPARING: 1, READY: 2, COMPLETED: 3 };
    const currentIdx = flow[order.status] ?? -1;
    const newIdx = flow[status];

    if (newIdx < currentIdx) {
      return res.status(400).json({
        error: 'Invalid transition',
        message: `Cannot revert from ${order.status} to ${status}`
      });
    }

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select();

    if (updateErr) throw updateErr;
    if (!updated || updated.length === 0) {
      return res.status(404).json({ error: 'Update failed — no rows affected' });
    }

    console.log(`✅ Updated: ${order.status} → ${status}`);

    await supabase.from('order_status_history').insert({
      order_id: id,
      status,
      note: note || `Status: ${status}`,
      changed_by: user.id
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`order:${id}`).emit('order:status', {
        order_id: id,
        status,
        note,
        token: order.token,
        timestamp: new Date().toISOString()
      });

      io.to('admin').emit('order:status', {
        order_id: id,
        token: order.token,
        status
      });
    }

    res.json({
      success: true,
      order_id: id,
      token: order.token,
      old_status: order.status,
      new_status: status
    });

  } catch (err) {
    console.error('❌ Status update error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Live Orders (with Cash Pending)
// ============================================
exports.getLiveOrders = async (req, res) => {
  try {
    const { restaurant_id } = req.user;

    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .in('status', ['PENDING_PAYMENT', 'CONFIRMED', 'PREPARING', 'READY'])
      .order('created_at', { ascending: false });

    // Separate: only cash PENDING_PAYMENT (exclude UPI PENDING)
    const filtered = (orders || []).filter(o => {
      if (o.status === 'PENDING_PAYMENT') {
        return o.payment_method === 'cash' && o.payment_status === 'PENDING';
      }
      return true;
    });

    res.json({ success: true, orders: filtered });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Cash Pending Only
// ============================================
exports.getCashPending = async (req, res) => {
  try {
    const { restaurant_id } = req.user;

    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('payment_method', 'cash')
      .eq('payment_status', 'PENDING')
      .eq('status', 'PENDING_PAYMENT')
      .order('created_at', { ascending: false });

    res.json({ success: true, orders: orders || [] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};