const cron = require('node-cron');
const supabase = require('../config/database');

module.exports = () => {
  // প্রতি ৩০ মিনিটে expired sessions delete
  cron.schedule('*/30 * * * *', async () => {
    try {
      const now = new Date().toISOString();

      const { data: expired } = await supabase
        .from('sessions')
        .select('id')
        .lt('expires_at', now);

      if (!expired || expired.length === 0) return;

      await supabase
        .from('sessions')
        .delete()
        .lt('expires_at', now);

      console.log(`🧹 Sessions cleaned: ${expired.length} expired`);

    } catch (err) {
      console.error('Session cleanup error:', err);
    }
  });

  // প্রতি ৬ ঘণ্টায় পুরনো OTPs delete
  cron.schedule('0 */6 * * *', async () => {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { data: oldOtps } = await supabase
        .from('customer_otps')
        .select('id')
        .lt('created_at', oneHourAgo);

      if (!oldOtps || oldOtps.length === 0) return;

      await supabase
        .from('customer_otps')
        .delete()
        .lt('created_at', oneHourAgo);

      console.log(`🧹 OTPs cleaned: ${oldOtps.length}`);

    } catch (err) {
      console.error('OTP cleanup error:', err);
    }
  });

  console.log('🧹 Session cleanup cron started');
};