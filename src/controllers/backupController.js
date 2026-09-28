const ExcelJS = require('exceljs');
const supabase = require('../config/database');

// ============================================
// EXPORT ORDERS AS EXCEL
// ============================================
exports.exportOrders = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { from, to } = req.query;

    // Default: last 90 days
    const endDate = to || new Date().toISOString().split('T')[0];
    const startDateObj = new Date();
    startDateObj.setDate(startDateObj.getDate() - 90);
    const startDate = from || startDateObj.toISOString().split('T')[0];

    console.log(`📊 Export: ${startDate} to ${endDate}`);

    // Fetch orders
    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .gte('created_at', startDate + 'T00:00:00')
      .lte('created_at', endDate + 'T23:59:59')
      .order('created_at', { ascending: true });

    if (!orders || orders.length === 0) {
      return res.status(404).json({ error: 'No orders in this range' });
    }

    // Fetch all order items for these orders
    const orderIds = orders.map(o => o.id);
    const { data: allItems } = await supabase
      .from('order_items')
      .select('*')
      .in('order_id', orderIds);

    // Group items by order
    const itemsByOrder = {};
    (allItems || []).forEach(item => {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push(item);
    });

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PUJA RESTAURANT';
    workbook.created = new Date();

    // ============================================
    // SHEET 1: Summary
    // ============================================
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Orders', key: 'orders', width: 10 },
      { header: 'UPI Orders', key: 'upi_orders', width: 12 },
      { header: 'Cash Orders', key: 'cash_orders', width: 13 },
      { header: 'UPI Sales (₹)', key: 'upi_sales', width: 15 },
      { header: 'Cash Sales (₹)', key: 'cash_sales', width: 15 },
      { header: 'Total Sales (₹)', key: 'total_sales', width: 16 }
    ];

    // Group by date
    const byDate = {};
    orders.forEach(o => {
      const date = o.created_at.split('T')[0];
      if (!byDate[date]) {
        byDate[date] = {
          date,
          orders: 0,
          upi_orders: 0,
          cash_orders: 0,
          upi_sales: 0,
          cash_sales: 0,
          total_sales: 0
        };
      }
      byDate[date].orders += 1;
      byDate[date].total_sales += parseFloat(o.total);
      if (o.payment_method === 'upi') {
        byDate[date].upi_orders += 1;
        byDate[date].upi_sales += parseFloat(o.total);
      } else if (o.payment_method === 'cash') {
        byDate[date].cash_orders += 1;
        byDate[date].cash_sales += parseFloat(o.total);
      }
    });

    // Add rows (sorted by date)
    Object.values(byDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(day => summarySheet.addRow(day));

    // Add TOTAL row
    const totalRow = summarySheet.addRow({
      date: 'TOTAL',
      orders: orders.length,
      upi_orders: orders.filter(o => o.payment_method === 'upi').length,
      cash_orders: orders.filter(o => o.payment_method === 'cash').length,
      upi_sales: orders.filter(o => o.payment_method === 'upi')
        .reduce((s, o) => s + parseFloat(o.total), 0),
      cash_sales: orders.filter(o => o.payment_method === 'cash')
        .reduce((s, o) => s + parseFloat(o.total), 0),
      total_sales: orders.reduce((s, o) => s + parseFloat(o.total), 0)
    });
    totalRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };

    // Header style
    summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summarySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } };
    summarySheet.getRow(1).alignment = { horizontal: 'center' };

    // ============================================
    // SHEET 2: Full Orders
    // ============================================
    const ordersSheet = workbook.addWorksheet('Orders');
    ordersSheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Time', key: 'time', width: 10 },
      { header: 'Token', key: 'token', width: 10 },
      { header: 'Order ID', key: 'order_number', width: 22 },
      { header: 'Customer', key: 'customer_name', width: 18 },
      { header: 'Mobile', key: 'customer_mobile', width: 15 },
      { header: 'Type', key: 'order_type', width: 10 },
      { header: 'Items', key: 'items', width: 40 },
      { header: 'Subtotal', key: 'subtotal', width: 12 },
      { header: 'GST', key: 'gst', width: 10 },
      { header: 'Total', key: 'total', width: 12 },
      { header: 'Payment', key: 'payment_method', width: 10 },
      { header: 'Status', key: 'payment_status', width: 12 },
      { header: 'Bill No', key: 'bill_no', width: 15 }
    ];

    orders.forEach(o => {
      const date = new Date(o.created_at);
      const items = (itemsByOrder[o.id] || [])
        .map(i => `${i.item_name} × ${i.quantity}`)
        .join(', ');

      ordersSheet.addRow({
        date: date.toLocaleDateString('en-GB'),
        time: date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        token: o.token,
        order_number: o.order_number,
        customer_name: o.customer_name,
        customer_mobile: o.customer_mobile,
        order_type: o.order_type === 'dinein' ? 'Dine-in' : 'Takeaway',
        items: items.length > 100 ? items.substring(0, 100) + '...' : items,
        subtotal: parseFloat(o.subtotal),
        gst: parseFloat(o.gst),
        total: parseFloat(o.total),
        payment_method: o.payment_method.toUpperCase(),
        payment_status: o.payment_status,
        bill_no: o.bill_no || '—'
      });
    });

    // Header style
    ordersSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ordersSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    ordersSheet.getRow(1).alignment = { horizontal: 'center' };

    // ============================================
    // SHEET 3: Top Items
    // ============================================
    const itemsSheet = workbook.addWorksheet('Top Items');
    itemsSheet.columns = [
      { header: 'Item Name', key: 'name', width: 30 },
      { header: 'Total Quantity', key: 'qty', width: 15 },
      { header: 'Total Revenue (₹)', key: 'revenue', width: 18 }
    ];

    const itemStats = {};
    (allItems || []).forEach(item => {
      if (!itemStats[item.item_name]) {
        itemStats[item.item_name] = { name: item.item_name, qty: 0, revenue: 0 };
      }
      itemStats[item.item_name].qty += item.quantity;
      itemStats[item.item_name].revenue += parseFloat(item.total);
    });

    Object.values(itemStats)
      .sort((a, b) => b.revenue - a.revenue)
      .forEach(item => itemsSheet.addRow(item));

    itemsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    itemsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };
    itemsSheet.getRow(1).alignment = { horizontal: 'center' };

    // ============================================
    // Send Excel file
    // ============================================
    const filename = `Backup_${startDate}_to_${endDate}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );

    await workbook.xlsx.write(res);
    res.end();

    console.log(`✅ Excel export: ${orders.length} orders`);

  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// BACKUP INFO (Stats)
// ============================================
exports.backupInfo = async (req, res) => {
  try {
    const { restaurant_id } = req.user;

    // Count total orders
    const { count: totalOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', restaurant_id);

    // Get earliest order date
    const { data: firstOrder } = await supabase
      .from('orders')
      .select('created_at')
      .eq('restaurant_id', restaurant_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    // Get day_book_summary stats
    const { count: dayBookCount } = await supabase
      .from('day_book_summary')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', restaurant_id);

    res.json({
      success: true,
      total_orders: totalOrders || 0,
      day_book_days: dayBookCount || 0,
      first_order: firstOrder?.created_at || null,
      storage_estimate_kb: Math.round((totalOrders || 0) * 2),
      storage_estimate_mb: Math.round((totalOrders || 0) * 2 / 1024 * 100) / 100,
      supabase_free_mb: 500,
      percent_used: Math.round(((totalOrders || 0) * 2 / 1024) / 500 * 10000) / 100
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};