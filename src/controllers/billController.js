const supabase = require('../config/database');
const billService = require('../services/billService');

// ============================================
// Customer: e-Bill PDF Download
// ============================================
exports.downloadBillPDF = async (req, res) => {
  try {
    const { orderId } = req.params;
    const customer = req.customer;

    const { data: order } = await supabase
      .from('orders')
      .select('customer_mobile, token, payment_method')
      .eq('id', orderId)
      .single();

    if (!order || order.customer_mobile !== customer.mobile) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (order.payment_method === 'cash') {
      return res.status(403).json({ error: 'Cash bills are provided by restaurant staff' });
    }

    const pdfBuffer = await billService.generateBillPDF(orderId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Bill_${order.token}.pdf"`
    );
    res.send(pdfBuffer);

  } catch (err) {
    console.error('Bill PDF error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Customer: Bill Data (JSON)
// ============================================
exports.getBillData = async (req, res) => {
  try {
    const { orderId } = req.params;
    const customer = req.customer;

    const data = await billService.getBillData(orderId);

    if (data.order.customer_mobile !== customer.mobile) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (data.order.payment_method === 'cash') {
      return res.status(403).json({ error: 'Cash bills are provided by restaurant staff' });
    }

    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Customer: Bill HTML View
// ============================================
exports.viewBillHTML = async (req, res) => {
  try {
    const { orderId } = req.params;
    const customer = req.customer;

    const { data: order } = await supabase
      .from('orders')
      .select('customer_mobile')
      .eq('id', orderId)
      .single();

    if (!order || order.customer_mobile !== customer.mobile) {
      return res.status(403).send('Access denied');
    }

    const html = await billService.generateBillHTML(orderId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
};

// ============================================
// Admin: Any Order Bill PDF
// ============================================
exports.adminDownloadBill = async (req, res) => {
  try {
    const { orderId } = req.params;

    const pdfBuffer = await billService.generateBillPDF(orderId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="Bill_${orderId}.pdf"`
    );
    res.send(pdfBuffer);

  } catch (err) {
    console.error('Admin bill error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Admin: Bill Data (JSON)
// ============================================
exports.adminGetBillData = async (req, res) => {
  try {
    const { orderId } = req.params;
    const data = await billService.getBillData(orderId);
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};