const supabase = require('../config/database');

// ============================================
// Sales Report
// ============================================
exports.getSalesReport = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to required' });
    }

    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .gte('created_at', from + 'T00:00:00')
      .lte('created_at', to + 'T23:59:59')
      .eq('payment_status', 'PAID')
      .order('created_at', { ascending: true });

    const upi = orders?.filter(o => o.payment_method === 'upi') || [];
    const cash = orders?.filter(o => o.payment_method === 'cash') || [];

    const upiSales = upi.reduce((s, o) => s + parseFloat(o.total), 0);
    const cashSales = cash.reduce((s, o) => s + parseFloat(o.total), 0);
    const totalSales = upiSales + cashSales;
    const totalGst = (orders || []).reduce((s, o) => s + parseFloat(o.gst), 0);

    const byDate = {};
    (orders || []).forEach(o => {
      const date = o.created_at.split('T')[0];
      if (!byDate[date]) byDate[date] = { date, orders: 0, sales: 0, upi: 0, cash: 0 };
      byDate[date].orders += 1;
      byDate[date].sales += parseFloat(o.total);
      if (o.payment_method === 'upi') byDate[date].upi += parseFloat(o.total);
      if (o.payment_method === 'cash') byDate[date].cash += parseFloat(o.total);
    });

    res.json({
      success: true,
      range: { from, to },
      summary: {
        total_orders: orders?.length || 0,
        upi_orders: upi.length,
        cash_orders: cash.length,
        upi_sales: parseFloat(upiSales.toFixed(2)),
        cash_sales: parseFloat(cashSales.toFixed(2)),
        total_sales: parseFloat(totalSales.toFixed(2)),
        total_gst: parseFloat(totalGst.toFixed(2)),
        net_sales: parseFloat((totalSales - totalGst).toFixed(2)),
        avg_order_value: orders?.length > 0
          ? parseFloat((totalSales / orders.length).toFixed(2))
          : 0
      },
      daily_breakdown: Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Top Items
// ============================================
exports.getTopItems = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { from, to, limit = 20 } = req.query;

    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .eq('restaurant_id', restaurant_id)
      .gte('created_at', from + 'T00:00:00')
      .lte('created_at', to + 'T23:59:59')
      .eq('payment_status', 'PAID');

    if (!orders || orders.length === 0) {
      return res.json({ success: true, items: [] });
    }

    const orderIds = orders.map(o => o.id);
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('item_name, quantity, price, total, menu_item_id')
      .in('order_id', orderIds);

    const itemStats = {};
    (orderItems || []).forEach(item => {
      const key = item.item_name;
      if (!itemStats[key]) {
        itemStats[key] = {
          item_name: item.item_name,
          menu_item_id: item.menu_item_id,
          total_quantity: 0,
          total_revenue: 0,
          order_count: 0
        };
      }
      itemStats[key].total_quantity += item.quantity;
      itemStats[key].total_revenue += parseFloat(item.total);
      itemStats[key].order_count += 1;
    });

    const sorted = Object.values(itemStats)
      .map(i => ({ ...i, total_revenue: parseFloat(i.total_revenue.toFixed(2)) }))
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, parseInt(limit));

    res.json({
      success: true,
      range: { from, to },
      count: sorted.length,
      items: sorted
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Hourly Sales
// ============================================
exports.getHourlySales = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { date } = req.query;

    if (!date) return res.status(400).json({ error: 'date required' });

    const { data: orders } = await supabase
      .from('orders')
      .select('created_at, total')
      .eq('restaurant_id', restaurant_id)
      .gte('created_at', date + 'T00:00:00')
      .lte('created_at', date + 'T23:59:59')
      .eq('payment_status', 'PAID');

    const hourly = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: String(i).padStart(2, '0') + ':00',
      orders: 0,
      sales: 0
    }));
    (orders || []).forEach(o => {
      const created = new Date(o.created_at);
      // IST = UTC + 5:30
      const istOffsetMs = 5.5 * 60 * 60 * 1000;
      const istDate = new Date(created.getTime() + istOffsetMs);
      const istHour = istDate.getUTCHours();
      hourly[istHour].orders += 1;
      hourly[istHour].sales += parseFloat(o.total);
    });

    hourly.forEach(h => h.sales = parseFloat(h.sales.toFixed(2)));

    const peakHour = hourly.reduce((max, h) => h.sales > max.sales ? h : max, hourly[0]);

    res.json({ success: true, date, hourly, peak_hour: peakHour });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Payment Breakdown
// ============================================
exports.getPaymentBreakdown = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { from, to } = req.query;

    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const { data: orders } = await supabase
      .from('orders')
      .select('payment_method, total, payment_status')
      .eq('restaurant_id', restaurant_id)
      .gte('created_at', from + 'T00:00:00')
      .lte('created_at', to + 'T23:59:59');

    const paid = (orders || []).filter(o => o.payment_status === 'PAID');
    const pending = (orders || []).filter(o => o.payment_status === 'PENDING');
    const failed = (orders || []).filter(o => o.payment_status === 'FAILED');

    const upi = paid.filter(o => o.payment_method === 'upi');
    const cash = paid.filter(o => o.payment_method === 'cash');

    const upiSales = upi.reduce((s, o) => s + parseFloat(o.total), 0);
    const cashSales = cash.reduce((s, o) => s + parseFloat(o.total), 0);
    const totalSales = upiSales + cashSales;

    res.json({
      success: true,
      breakdown: {
        upi: {
          count: upi.length,
          amount: parseFloat(upiSales.toFixed(2)),
          percentage: totalSales > 0 ? parseFloat((upiSales / totalSales * 100).toFixed(2)) : 0
        },
        cash: {
          count: cash.length,
          amount: parseFloat(cashSales.toFixed(2)),
          percentage: totalSales > 0 ? parseFloat((cashSales / totalSales * 100).toFixed(2)) : 0
        }
      },
      totals: {
        paid_orders: paid.length,
        pending_orders: pending.length,
        failed_orders: failed.length,
        total_sales: parseFloat(totalSales.toFixed(2))
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// 30-Day Rolling
// ============================================
exports.get30DayRolling = async (req, res) => {
  try {
    const { restaurant_id } = req.user;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const { data: orders } = await supabase
      .from('orders')
      .select('created_at, total, gst, payment_method')
      .eq('restaurant_id', restaurant_id)
      .gte('created_at', startDate.toISOString().split('T')[0] + 'T00:00:00')
      .lte('created_at', endDate.toISOString().split('T')[0] + 'T23:59:59')
      .eq('payment_status', 'PAID');

    const byDate = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = d.toISOString().split('T')[0];
      byDate[date] = { date, orders: 0, sales: 0, gst: 0, upi: 0, cash: 0 };
    }

    (orders || []).forEach(o => {
      const date = o.created_at.split('T')[0];
      if (byDate[date]) {
        byDate[date].orders += 1;
        byDate[date].sales += parseFloat(o.total);
        byDate[date].gst += parseFloat(o.gst);
        if (o.payment_method === 'upi') byDate[date].upi += parseFloat(o.total);
        if (o.payment_method === 'cash') byDate[date].cash += parseFloat(o.total);
      }
    });

    const days = Object.values(byDate).map(d => ({
      ...d,
      sales: parseFloat(d.sales.toFixed(2)),
      gst: parseFloat(d.gst.toFixed(2)),
      upi: parseFloat(d.upi.toFixed(2)),
      cash: parseFloat(d.cash.toFixed(2))
    }));

    const totalOrders = days.reduce((s, d) => s + d.orders, 0);
    const totalSales = days.reduce((s, d) => s + d.sales, 0);
    const totalUpi = days.reduce((s, d) => s + d.upi, 0);
    const totalCash = days.reduce((s, d) => s + d.cash, 0);
    const peakDay = days.reduce((max, d) => d.sales > max.sales ? d : max, days[0]);

    res.json({
      success: true,
      range: {
        from: startDate.toISOString().split('T')[0],
        to: endDate.toISOString().split('T')[0]
      },
      days,
      summary: {
        total_orders: totalOrders,
        total_sales: parseFloat(totalSales.toFixed(2)),
        total_upi: parseFloat(totalUpi.toFixed(2)),
        total_cash: parseFloat(totalCash.toFixed(2)),
        avg_daily_sales: parseFloat((totalSales / 30).toFixed(2)),
        peak_day: peakDay,
        upi_percentage: totalSales > 0 ? parseFloat((totalUpi / totalSales * 100).toFixed(2)) : 0,
        cash_percentage: totalSales > 0 ? parseFloat((totalCash / totalSales * 100).toFixed(2)) : 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};