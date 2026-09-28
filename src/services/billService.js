const PDFDocument = require('pdfkit');
const supabase = require('../config/database');

// ============================================
// Constants — 80mm Thermal Printer
// ============================================
const MM_TO_PT = 2.834645;
const PAPER_WIDTH_MM = 80;
const CONTENT_WIDTH_MM = 72;
const SIDE_MARGIN_MM = 4;
const TOP_MARGIN_MM = 3;

const PAPER_WIDTH_PT = PAPER_WIDTH_MM * MM_TO_PT;      // 226.77
const CONTENT_WIDTH_PT = CONTENT_WIDTH_MM * MM_TO_PT;  // 204.09
const SIDE_MARGIN_PT = SIDE_MARGIN_MM * MM_TO_PT;
const TOP_MARGIN_PT = TOP_MARGIN_MM * MM_TO_PT;

// ============================================
// Page Height — Exact Table (Max of range)
// ============================================
function calculatePageHeight(itemCount) {
  let heightMm;

  if (itemCount <= 3) {
    heightMm = 145;   // range: 130-145
  } else if (itemCount <= 5) {
    heightMm = 160;   // range: 145-160
  } else if (itemCount <= 10) {
    heightMm = 195;   // range: 160-195
  } else if (itemCount <= 15) {
    heightMm = 240;   // range: 195-240
  } else if (itemCount <= 20) {
    heightMm = 290;   // range: 240-290
  } else if (itemCount <= 30) {
    heightMm = 380;   // range: 290-380
  } else {
    heightMm = 380 + ((itemCount - 30) * 8);  // dynamic
  }

  if (heightMm > 650) heightMm = 650;

  return heightMm * MM_TO_PT;
}

// ============================================
// 80mm Thermal Printer Bill PDF — 1 Page
// ============================================
exports.generateBillPDF = async (orderId) => {
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (!order) throw new Error('Order not found');

  const { data: items } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('*')
    .eq('id', order.restaurant_id)
    .single();

  const pageHeight = calculatePageHeight(items.length);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAPER_WIDTH_PT, pageHeight],
      margins: {
        top: TOP_MARGIN_PT,
        bottom: 3 * MM_TO_PT,
        left: SIDE_MARGIN_PT,
        right: SIDE_MARGIN_PT
      },
      autoFirstPage: true,
      bufferPages: false
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Dashed Line draw function
    function drawDash() {
      const y = doc.y + 2;
      doc.save();
      doc.moveTo(SIDE_MARGIN_PT, y)
         .lineTo(PAPER_WIDTH_PT - SIDE_MARGIN_PT, y)
         .lineWidth(0.5)
         .dash(2, { space: 2 })
         .stroke('#000');
      doc.restore();
      doc.y = y + 4;
    }

    // ========== HEADER ==========
    doc.fontSize(12).font('Helvetica-Bold')
       .text((restaurant.name || 'RESTAURANT').toUpperCase(), {
         align: 'center',
         width: CONTENT_WIDTH_PT,
         lineGap: 0
       });

    if (restaurant.tagline) {
      doc.fontSize(6.5).font('Helvetica-Oblique')
         .text(restaurant.tagline, {
           align: 'center',
           width: CONTENT_WIDTH_PT,
           lineGap: 0
         });
    }

    doc.fontSize(6).font('Helvetica');
    if (restaurant.address) {
      doc.text(restaurant.address, { align: 'center', width: CONTENT_WIDTH_PT, lineGap: 0 });
    }
    if (restaurant.phone) {
      doc.text('Phone: ' + restaurant.phone, { align: 'center', width: CONTENT_WIDTH_PT, lineGap: 0 });
    }
    if (restaurant.gstin) {
      doc.text('GSTIN: ' + restaurant.gstin, { align: 'center', width: CONTENT_WIDTH_PT, lineGap: 0 });
    }
    if (restaurant.fssai) {
      doc.text('FSSAI: ' + restaurant.fssai, { align: 'center', width: CONTENT_WIDTH_PT, lineGap: 0 });
    }

    doc.moveDown(0.2);
    drawDash();

    // ========== BILL INFO ==========
    const billNo = order.bill_no || 'INV-' + (order.order_number?.split('-').pop() || '00001');
    const orderDate = new Date(order.created_at);
    const dateStr = orderDate.toLocaleDateString('en-GB');
    const timeStr = orderDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    doc.fontSize(6).font('Helvetica');
    doc.text(`Bill No   : ${billNo}`, { lineGap: 0 });
    doc.text(`Date      : ${dateStr}`, { lineGap: 0 });
    doc.text(`Time      : ${timeStr}`, { lineGap: 0 });
    doc.text(`Order ID  : ${order.order_number}`, { lineGap: 0 });

    doc.moveDown(0.2);

    // ========== TOKEN ==========
    doc.fontSize(7).font('Helvetica-Bold')
       .text('TOKEN NO', { align: 'center', width: CONTENT_WIDTH_PT, lineGap: 0 });

    doc.fontSize(18).font('Helvetica-Bold')
       .text(order.token, { align: 'center', width: CONTENT_WIDTH_PT, lineGap: 0 });

    doc.moveDown(0.1);

    doc.fontSize(6).font('Helvetica');
    doc.text(`Order Type : ${order.order_type === 'dinein' ? 'DINE-IN' : 'TAKEAWAY'}`, { lineGap: 0 });
    doc.text(`Customer   : ${order.customer_name}`, { lineGap: 0 });
    doc.text(`Mobile     : ${order.customer_mobile}`, { lineGap: 0 });
    if (order.cashier_name) {
      doc.text(`Cashier    : ${order.cashier_name}`, { lineGap: 0 });
    }

    doc.moveDown(0.2);
    drawDash();

    // ========== ITEMS TABLE ==========
    const colItem = 30;
    const colQty  = 4;
    const colRate = 8;
    const colAmt  = 8;

    doc.fontSize(6).font('Helvetica-Bold');
    doc.text(
      'ITEM'.padEnd(colItem) + 'QTY'.padStart(colQty) + 'RATE'.padStart(colRate) + 'AMT'.padStart(colAmt),
      { lineGap: 0 }
    );

    doc.font('Helvetica');
    items.forEach(item => {
      let name = item.item_name;
      if (name.length > colItem) name = name.substring(0, colItem);
      else name = name.padEnd(colItem);
      const qty  = String(item.quantity).padStart(colQty);
      const rate = String(parseFloat(item.price).toFixed(0)).padStart(colRate);
      const amt  = String(parseFloat(item.total).toFixed(0)).padStart(colAmt);
      doc.text(`${name}${qty}${rate}${amt}`, { lineGap: 0 });
    });

    doc.moveDown(0.2);
    drawDash();

    // ========== CALCULATION ==========
    const subtotal = parseFloat(order.subtotal) || 0;
    const discount = parseFloat(order.discount) || 0;
    const gst = parseFloat(order.gst) || 0;
    const cgst = gst / 2;
    const sgst = gst / 2;
    const total = parseFloat(order.total) || 0;
    const taxable = subtotal - discount;

    function row(label, value) {
      const l = label.padEnd(25);
      const v = value.toString().padStart(13);
      doc.text(`${l}${v}`, { lineGap: 0 });
    }

    doc.fontSize(6).font('Helvetica');
    row('Subtotal', `Rs.${subtotal.toFixed(2)}`);
    if (discount > 0) {
      row('Discount', `-Rs.${discount.toFixed(2)}`);
    }
    row('Taxable Amount', `Rs.${taxable.toFixed(2)}`);
    row('CGST @ 2.5%', `Rs.${cgst.toFixed(2)}`);
    row('SGST @ 2.5%', `Rs.${sgst.toFixed(2)}`);

    doc.moveDown(0.2);

    // ========== GRAND TOTAL ==========
    doc.fontSize(10).font('Helvetica-Bold')
       .text(`GRAND TOTAL: Rs.${total.toFixed(2)}`, {
         align: 'center',
         width: CONTENT_WIDTH_PT,
         lineGap: 0
       });

    doc.moveDown(0.2);
    drawDash();

    // ========== PAYMENT ==========
    doc.fontSize(6).font('Helvetica-Bold')
       .text('PAYMENT DETAILS', { lineGap: 0 });
    doc.moveDown(0.05);

    doc.font('Helvetica');
    const pm = (order.payment_method || '').toUpperCase();
    doc.text(`Payment Method : ${pm}`, { lineGap: 0 });

    if (order.payment_status === 'PAID') {
      doc.text(`Amount Paid    : Rs.${total.toFixed(2)}`, { lineGap: 0 });

      if (pm === 'CASH') {
        if (order.cash_received) {
          doc.text(`Cash Received  : Rs.${parseFloat(order.cash_received).toFixed(2)}`, { lineGap: 0 });
        }
        if (order.change_returned) {
          doc.text(`Change Returned: Rs.${parseFloat(order.change_returned).toFixed(2)}`, { lineGap: 0 });
        }
      } else if (pm === 'UPI' && order.payment_id) {
        doc.text(`UPI Ref No     : ${order.payment_id}`, { lineGap: 0 });
      }

      doc.moveDown(0.05);
      doc.fontSize(8).font('Helvetica-Bold')
         .text('Payment Status : PAID', {
           align: 'center',
           width: CONTENT_WIDTH_PT,
           lineGap: 0
         });
    } else {
      doc.moveDown(0.05);
      doc.fontSize(8).font('Helvetica-Bold')
         .text('Payment Status : PENDING', {
           align: 'center',
           width: CONTENT_WIDTH_PT,
           lineGap: 0
         });
    }

    doc.moveDown(0.2);
    drawDash();

    // ========== FOOTER ==========
    doc.fontSize(8).font('Helvetica-Bold')
       .text('THANK YOU!', {
         align: 'center',
         width: CONTENT_WIDTH_PT,
         lineGap: 0
       });

    doc.fontSize(6.5).font('Helvetica-Oblique')
       .text('VISIT AGAIN', {
         align: 'center',
         width: CONTENT_WIDTH_PT,
         lineGap: 0
       });

    doc.moveDown(0.3);

    // ========== QR CODE PLACEHOLDER (20mm) ==========
    const QR_SIZE_MM = 20;
    const QR_SIZE_PT = QR_SIZE_MM * MM_TO_PT;

    const qrX = (PAPER_WIDTH_PT - QR_SIZE_PT) / 2;
    const qrY = doc.y;

    doc.save();
    doc.rect(qrX, qrY, QR_SIZE_PT, QR_SIZE_PT)
       .lineWidth(0.5)
       .stroke('#000');
    doc.restore();

    doc.y = qrY + QR_SIZE_PT + 3;

    doc.fontSize(6).font('Helvetica-Bold')
       .text('SCAN FOR MENU', {
         align: 'center',
         width: CONTENT_WIDTH_PT,
         lineGap: 0
       });

    doc.fontSize(5.5).font('Helvetica-Oblique')
       .text('www.spicegarden.com', {
         align: 'center',
         width: CONTENT_WIDTH_PT,
         lineGap: 0
       });

    doc.end();
  });
};

// ============================================
// HTML Bill (Preview)
// ============================================
exports.generateBillHTML = async (orderId) => {
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (!order) throw new Error('Order not found');

  const { data: items } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('*')
    .eq('id', order.restaurant_id)
    .single();

  const billNo = order.bill_no || 'INV-' + (order.order_number?.split('-').pop() || '00001');
  const orderDate = new Date(order.created_at);
  const dateStr = orderDate.toLocaleDateString('en-GB');
  const timeStr = orderDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const gst = parseFloat(order.gst) || 0;
  const cgst = gst / 2;
  const sgst = gst / 2;
  const subtotal = parseFloat(order.subtotal) || 0;
  const discount = parseFloat(order.discount) || 0;
  const total = parseFloat(order.total) || 0;
  const taxable = subtotal - discount;

  const itemsHTML = items.map(item => `
    <tr>
      <td class="item-name">${item.item_name}</td>
      <td class="center">${item.quantity}</td>
      <td class="right">${parseFloat(item.price).toFixed(2)}</td>
      <td class="right">${parseFloat(item.total).toFixed(2)}</td>
    </tr>
  `).join('');

  const paymentBlock = order.payment_status === 'PAID'
    ? `
      <div class="row"><span>Payment Method</span><span>${(order.payment_method || '').toUpperCase()}</span></div>
      <div class="row"><span>Amount Paid</span><span>Rs.${total.toFixed(2)}</span></div>
      ${order.payment_method === 'cash' && order.cash_received ? `
        <div class="row"><span>Cash Received</span><span>Rs.${parseFloat(order.cash_received).toFixed(2)}</span></div>
        <div class="row"><span>Change Returned</span><span>Rs.${parseFloat(order.change_returned || 0).toFixed(2)}</span></div>
      ` : ''}
      ${order.payment_method === 'upi' && order.payment_id ? `
        <div class="row"><span>UPI Ref No</span><span>${order.payment_id}</span></div>
      ` : ''}
      <div class="paid-badge">PAID</div>
    `
    : `
      <div class="row"><span>Payment Method</span><span>${(order.payment_method || '').toUpperCase()}</span></div>
      <div class="pending-badge">PENDING</div>
    `;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bill ${billNo}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Courier New', monospace; background: #2a2a2a; padding: 20px; display: flex; justify-content: center; min-height: 100vh; }
        .bill { background: #fff; width: 80mm; max-width: 100%; padding: 3mm 4mm; color: #000; font-size: 10px; line-height: 1.3; box-shadow: 0 4px 30px rgba(0,0,0,0.4); }
        .header { text-align: center; padding-bottom: 6px; border-bottom: 1px dashed #000; margin-bottom: 6px; }
        .header h1 { font-size: 15px; font-weight: 900; letter-spacing: 1px; margin-bottom: 2px; }
        .header .tagline { font-size: 9px; font-style: italic; margin-bottom: 3px; }
        .header .info { font-size: 8px; line-height: 1.4; }
        .dash { border-top: 1px dashed #000; margin: 5px 0; }
        .meta { font-size: 9px; line-height: 1.5; margin-bottom: 5px; }
        .meta .row { display: flex; justify-content: space-between; }
        .token-box { border: 2px dashed #000; padding: 6px; text-align: center; margin: 6px 0; }
        .token-label { font-size: 8px; font-weight: 700; letter-spacing: 1px; }
        .token-value { font-size: 22px; font-weight: 900; letter-spacing: 2px; margin: 2px 0; }
        table { width: 100%; font-size: 9px; border-collapse: collapse; margin: 5px 0; }
        th { text-align: left; padding: 3px 2px; border-bottom: 1px solid #000; font-weight: 700; }
        th.center { text-align: center; }
        th.right { text-align: right; }
        td { padding: 2px 2px; }
        td.center { text-align: center; }
        td.right { text-align: right; }
        td.item-name { word-break: break-word; max-width: 32mm; }
        .totals { font-size: 9px; line-height: 1.5; }
        .totals .row { display: flex; justify-content: space-between; }
        .grand { font-size: 12px; font-weight: 900; text-align: center; padding: 6px 0; border-top: 2px solid #000; border-bottom: 2px solid #000; margin: 6px 0; }
        .payment-section { font-size: 9px; line-height: 1.5; }
        .payment-section .row { display: flex; justify-content: space-between; }
        .paid-badge { text-align: center; font-weight: 900; font-size: 12px; padding: 5px 0; letter-spacing: 2px; border: 2px solid #000; margin-top: 5px; }
        .pending-badge { text-align: center; font-weight: 900; font-size: 11px; padding: 5px 0; border: 2px dashed #000; margin-top: 5px; }
        .footer { text-align: center; font-size: 9px; margin-top: 8px; }
        .footer .thanks { font-weight: 900; font-size: 11px; }
        .qr-placeholder { margin-top: 8px; padding: 6px; text-align: center; font-size: 8px; }
        .qr-box { width: 20mm; height: 20mm; border: 1px solid #000; margin: 0 auto; }
        .actions { display: flex; gap: 6px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #ccc; }
        .btn { flex: 1; padding: 10px; border: none; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; text-decoration: none; text-align: center; display: block; }
        .btn-green { background: #16a34a; color: #fff; }
        .btn-gray { background: #f0f0f0; color: #333; }
        @media print {
          body { background: #fff; padding: 0; }
          .bill { box-shadow: none; width: 80mm; }
          .actions { display: none; }
        }
        @page { size: 80mm auto; margin: 0; }
      </style>
    </head>
    <body>
      <div class="bill">
        <div class="header">
          <h1>${(restaurant.name || 'RESTAURANT').toUpperCase()}</h1>
          ${restaurant.tagline ? `<div class="tagline">${restaurant.tagline}</div>` : ''}
          <div class="info">
            ${restaurant.address || ''}<br>
            ${restaurant.phone ? 'Phone: ' + restaurant.phone + '<br>' : ''}
            ${restaurant.gstin ? 'GSTIN: ' + restaurant.gstin + '<br>' : ''}
            ${restaurant.fssai ? 'FSSAI: ' + restaurant.fssai : ''}
          </div>
        </div>

        <div class="meta">
          <div class="row"><span>Bill No</span><span>${billNo}</span></div>
          <div class="row"><span>Date</span><span>${dateStr}</span></div>
          <div class="row"><span>Time</span><span>${timeStr}</span></div>
          <div class="row"><span>Order ID</span><span>${order.order_number}</span></div>
        </div>

        <div class="token-box">
          <div class="token-label">TOKEN NO</div>
          <div class="token-value">${order.token}</div>
        </div>

        <div class="meta">
          <div class="row"><span>Order Type</span><span>${order.order_type === 'dinein' ? 'DINE-IN' : 'TAKEAWAY'}</span></div>
          <div class="row"><span>Customer</span><span>${order.customer_name}</span></div>
          <div class="row"><span>Mobile</span><span>${order.customer_mobile}</span></div>
          ${order.cashier_name ? `<div class="row"><span>Cashier</span><span>${order.cashier_name}</span></div>` : ''}
        </div>

        <div class="dash"></div>

        <table>
          <thead>
            <tr><th>ITEM</th><th class="center">QTY</th><th class="right">RATE</th><th class="right">AMT</th></tr>
          </thead>
          <tbody>${itemsHTML}</tbody>
        </table>

        <div class="dash"></div>

        <div class="totals">
          <div class="row"><span>Subtotal</span><span>Rs.${subtotal.toFixed(2)}</span></div>
          ${discount > 0 ? `<div class="row"><span>Discount</span><span>-Rs.${discount.toFixed(2)}</span></div>` : ''}
          <div class="row"><span>Taxable Amount</span><span>Rs.${taxable.toFixed(2)}</span></div>
          <div class="row"><span>CGST @ 2.5%</span><span>Rs.${cgst.toFixed(2)}</span></div>
          <div class="row"><span>SGST @ 2.5%</span><span>Rs.${sgst.toFixed(2)}</span></div>
        </div>

        <div class="grand">GRAND TOTAL: Rs.${total.toFixed(2)}</div>

        <div class="payment-section">${paymentBlock}</div>

        <div class="dash"></div>

        <div class="footer">
          <div class="thanks">THANK YOU!</div>
          <div>VISIT AGAIN</div>
        </div>

        <div class="qr-placeholder">
          <div class="qr-box"></div>
          <div style="margin-top:4px;">SCAN FOR MENU</div>
          <div style="font-size:7px;">www.spicegarden.com</div>
        </div>

        <div class="actions">
          <a class="btn btn-green" href="/api/payment/bill-public?orderId=${orderId}" download>Download PDF</a>
          <button class="btn btn-gray" onclick="window.print()">Print</button>
        </div>
      </div>
    </body>
    </html>
  `;
};

// ============================================
// Bill Data (JSON)
// ============================================
exports.getBillData = async (orderId) => {
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (!order) throw new Error('Order not found');

  const { data: items } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('*')
    .eq('id', order.restaurant_id)
    .single();

  const billNo = order.bill_no || 'INV-' + (order.order_number?.split('-').pop() || '00001');
  const gst = parseFloat(order.gst) || 0;

  return {
    restaurant,
    bill_no: billNo,
    order: {
      id: order.id,
      order_number: order.order_number,
      token: order.token,
      order_type: order.order_type,
      customer_name: order.customer_name,
      customer_mobile: order.customer_mobile,
      subtotal: order.subtotal,
      discount: order.discount || 0,
      gst: gst,
      cgst: gst / 2,
      sgst: gst / 2,
      total: order.total,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      payment_id: order.payment_id,
      cash_received: order.cash_received,
      change_returned: order.change_returned,
      cashier_name: order.cashier_name,
      status: order.status,
      created_at: order.created_at
    },
    items
  };
};