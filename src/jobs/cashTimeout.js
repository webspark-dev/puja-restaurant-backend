const cron = require('node-cron');
const supabase = require('../config/database');

module.exports = () => {
  // প্রতি মিনিটে check
  cron.schedule('* * * * *', async () => {
    try {
      // 5 মিনিট আগের PENDING cash orders
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const { data: orders } = await supabase
        .from('orders')
        .select('id, token, customer_name, total')
        .eq('payment_method', 'cash')
        .eq('payment_status', 'PENDING')
        .eq('status', 'PENDING_PAYMENT')
        .lt('created_at', fiveMinAgo);

      if (!orders || orders.length === 0) return;

      console.log(`⏰ Cash timeout: ${orders.length} orders to cancel`);

      for (const order of orders) {
        // Cancel order
        await supabase
          .from('orders')
          .update({
            status: 'CANCELLED',
            updated_at: new Date().toISOString()
          })
          .eq('id', order.id);

        // Status history
        await supabase.from('order_status_history').insert({
          order_id: order.id,
          status: 'CANCELLED',
          note: 'Auto-cancelled: Cash not paid within 5 minutes'
        });

        console.log(`   ❌ Cancelled: ${order.token} (${order.customer_name})`);

        // WebSocket notify (if customer online)
        const io = global.io;
        if (io) {
          io.to(`order:${order.id}`).emit('order:cancelled', {
            order_id: order.id,
            token: order.token,
            reason: 'Cash payment timeout'
          });
        }
      }

    } catch (err) {
      console.error('Cash timeout cron error:', err);
    }
  });

  console.log('⏰ Cash timeout cron started');
};