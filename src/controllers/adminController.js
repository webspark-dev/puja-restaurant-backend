const supabase = require('../config/database');

// ============================================
// Ordering ON/OFF Toggle
// ============================================
exports.toggleOrdering = async (req, res) => {
  try {
    const { enabled, pause_message } = req.body;
    const { restaurant_id, id: user_id } = req.user;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) required' });
    }

    const { data, error } = await supabase
      .from('restaurant_settings')
      .update({
        ordering_enabled: enabled,
        pause_message: pause_message || 'Ordering temporarily paused',
        updated_at: new Date().toISOString()
      })
      .eq('restaurant_id', restaurant_id)
      .select()
      .single();

    if (error) throw error;

    const io = req.app.get('io');
    if (io) {
      io.emit('ordering:changed', { enabled, pause_message });
    }

    await supabase.from('audit_log').insert({
      user_id,
      action: 'TOGGLE_ORDERING',
      entity: 'restaurant_settings',
      details: { enabled, pause_message }
    });

    res.json({
      success: true,
      ordering_enabled: data.ordering_enabled,
      pause_message: data.pause_message
    });

  } catch (err) {
    console.error('Toggle error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Get Ordering Status
// ============================================
exports.getOrderingStatus = async (req, res) => {
  try {
    const { restaurant_id } = req.user;

    const { data } = await supabase
      .from('restaurant_settings')
      .select('ordering_enabled, pause_message, auto_schedule, open_time, close_time')
      .eq('restaurant_id', restaurant_id)
      .single();

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Auto Schedule Update
// ============================================
exports.updateSchedule = async (req, res) => {
  try {
    const { auto_schedule, open_time, close_time } = req.body;
    const { restaurant_id } = req.user;

    const { data, error } = await supabase
      .from('restaurant_settings')
      .update({
        auto_schedule,
        open_time,
        close_time,
        updated_at: new Date().toISOString()
      })
      .eq('restaurant_id', restaurant_id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, settings: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Dashboard Stats (Today)
// ============================================
exports.getDashboardStats = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .gte('created_at', today.toISOString())
      .eq('payment_status', 'PAID');

    const totalOrders = orders?.length || 0;
    const upiOrders = orders?.filter(o => o.payment_method === 'upi') || [];
    const cashOrders = orders?.filter(o => o.payment_method === 'cash') || [];

    const upiSales = upiOrders.reduce((s, o) => s + parseFloat(o.total), 0);
    const cashSales = cashOrders.reduce((s, o) => s + parseFloat(o.total), 0);
    const totalSales = upiSales + cashSales;

    const { data: liveOrders } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .in('status', ['CONFIRMED', 'PREPARING', 'READY'])
      .order('created_at', { ascending: false });

    const { count: cashPendingCount } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', restaurant_id)
      .eq('payment_method', 'cash')
      .eq('payment_status', 'PENDING')
      .eq('status', 'PENDING_PAYMENT');

    const liveCounts = {
      confirmed: liveOrders?.filter(o => o.status === 'CONFIRMED').length || 0,
      preparing: liveOrders?.filter(o => o.status === 'PREPARING').length || 0,
      ready: liveOrders?.filter(o => o.status === 'READY').length || 0
    };

    res.json({
      success: true,
      today: {
        total_orders: totalOrders,
        upi_orders: upiOrders.length,
        cash_orders: cashOrders.length,
        upi_sales: parseFloat(upiSales.toFixed(2)),
        cash_sales: parseFloat(cashSales.toFixed(2)),
        total_sales: parseFloat(totalSales.toFixed(2))
      },
      live: {
        ...liveCounts,
        total: liveOrders?.length || 0,
        cash_pending: cashPendingCount || 0
      }
    });

  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Day Book
// ============================================
exports.getDayBook = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'date (YYYY-MM-DD) required' });
    }

    const start = date + 'T00:00:00';
    const end = date + 'T23:59:59';

    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .gte('created_at', start)
      .lte('created_at', end)
      .eq('payment_status', 'PAID')
      .order('created_at', { ascending: true });

    const upi = orders?.filter(o => o.payment_method === 'upi') || [];
    const cash = orders?.filter(o => o.payment_method === 'cash') || [];

    res.json({
      success: true,
      date,
      orders: orders || [],
      summary: {
        total_orders: orders?.length || 0,
        upi_orders: upi.length,
        cash_orders: cash.length,
        upi_sales: parseFloat(upi.reduce((s, o) => s + parseFloat(o.total), 0).toFixed(2)),
        cash_sales: parseFloat(cash.reduce((s, o) => s + parseFloat(o.total), 0).toFixed(2)),
        total_sales: parseFloat(
          (orders || []).reduce((s, o) => s + parseFloat(o.total), 0).toFixed(2)
        )
      }
    });

  } catch (err) {
    console.error('Day book error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Order History
// ============================================
exports.getOrderHistory = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { status, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: orders, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      count: orders?.length || 0,
      orders: orders || []
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Kitchen Orders
// ============================================
exports.getKitchenOrders = async (req, res) => {
  try {
    const { restaurant_id } = req.user;

    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('payment_status', 'PAID')
      .in('status', ['CONFIRMED', 'PREPARING', 'READY'])
      .order('created_at', { ascending: true });

    const ordersWithItems = await Promise.all((orders || []).map(async (order) => {
      const { data: items } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', order.id);

      return { ...order, items: items || [] };
    }));

    res.json({
      success: true,
      count: ordersWithItems.length,
      orders: ordersWithItems
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};