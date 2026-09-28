const cron = require('node-cron');
const supabase = require('../config/database');

module.exports = () => {
  // প্রতি মিনিটে check — auto open/close time
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5);   // "HH:MM"

      // Auto schedule enabled restaurants
      const { data: settings } = await supabase
        .from('restaurant_settings')
        .select('*')
        .eq('auto_schedule', true);

      if (!settings || settings.length === 0) return;

      for (const s of settings) {
        let shouldBeOpen = s.ordering_enabled;
        let changed = false;

        // Open time match
        if (s.open_time && currentTime === s.open_time.slice(0, 5)) {
          if (!s.ordering_enabled) {
            shouldBeOpen = true;
            changed = true;
          }
        }

        // Close time match
        if (s.close_time && currentTime === s.close_time.slice(0, 5)) {
          if (s.ordering_enabled) {
            shouldBeOpen = false;
            changed = true;
          }
        }

        if (changed) {
          await supabase
            .from('restaurant_settings')
            .update({
              ordering_enabled: shouldBeOpen,
              updated_at: new Date().toISOString()
            })
            .eq('id', s.id);

          console.log(`🔄 Auto schedule: Ordering ${shouldBeOpen ? 'ON' : 'OFF'} at ${currentTime}`);

          // WebSocket notify
          const io = global.io;
          if (io) {
            io.emit('ordering:changed', {
              enabled: shouldBeOpen,
              auto: true
            });
          }
        }
      }

    } catch (err) {
      console.error('Auto schedule error:', err);
    }
  });

  console.log('🔄 Auto schedule cron started');
};