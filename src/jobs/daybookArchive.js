const cron = require('node-cron');
const supabase = require('../config/database');

module.exports = () => {
  // প্রতিদিন রাত ২টায় check (old data archive)
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('📊 Day Book archive check starting...');

      // Get all restaurants
      const { data: restaurants } = await supabase
        .from('restaurants')
        .select('id, name');

      if (!restaurants) return;

      for (const rest of restaurants) {
        // 7 days ago
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];

        // Get old orders (paid)
        const { data: oldOrders } = await supabase
          .from('orders')
          .select('*')
          .eq('restaurant_id', rest.id)
          .eq('payment_status', 'PAID')
          .lt('created_at', cutoffDate + 'T00:00:00');

        if (!oldOrders || oldOrders.length === 0) continue;

        // Group by date
        const byDate = {};
        oldOrders.forEach(o => {
          const date = o.created_at.split('T')[0];
          if (!byDate[date]) byDate[date] = [];
          byDate[date].push(o);
        });

        // Save summary for each date
        for (const [date, orders] of Object.entries(byDate)) {
          const upi = orders.filter(o => o.payment_method === 'upi');
          const cash = orders.filter(o => o.payment_method === 'cash');

          const summary = {
            restaurant_id: rest.id,
            date,
            total_orders: orders.length,
            upi_orders: upi.length,
            cash_orders: cash.length,
            upi_sales: upi.reduce((s, o) => s + parseFloat(o.total), 0),
            cash_sales: cash.reduce((s, o) => s + parseFloat(o.total), 0),
            total_sales: orders.reduce((s, o) => s + parseFloat(o.total), 0),
            archived: true
          };

          // Upsert summary
          await supabase
            .from('day_book_summary')
            .upsert(summary, {
              onConflict: 'restaurant_id,date'
            });

          console.log(`   📅 Archived: ${rest.name} — ${date} (${orders.length} orders)`);
        }
      }

      console.log('✅ Day Book archive completed');

    } catch (err) {
      console.error('Day book archive error:', err);
    }
  });

  console.log('📊 Day Book archive cron started');
};