const supabase = require('../config/database');

// ============================================
// CUSTOMER: Add to Notify List
// ============================================
exports.addToNotifyList = async (req, res) => {
  try {
    const { restaurant_id, mobile } = req.body;

    if (!restaurant_id || !mobile) {
      return res.status(400).json({ error: 'restaurant_id and mobile required' });
    }

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({ error: 'Valid 10-digit mobile required' });
    }

    const { data: existing } = await supabase
      .from('notify_list')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('mobile', mobile)
      .single();

    if (existing) {
      return res.json({
        success: true,
        message: 'Already in notify list',
        already_exists: true
      });
    }

    const { error } = await supabase
      .from('notify_list')
      .insert({
        restaurant_id,
        mobile,
        requested_at: new Date().toISOString(),
        notified: false
      });

    if (error) throw error;

    console.log(`📱 Notify list: ${mobile} added`);

    res.json({
      success: true,
      message: 'You will be notified when we open',
      mobile
    });

  } catch (err) {
    console.error('Notify add error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Get Notify List
// ============================================
exports.getNotifyList = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { notified } = req.query;

    let query = supabase
      .from('notify_list')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .order('requested_at', { ascending: false });

    if (notified === 'true') {
      query = query.eq('notified', true);
    } else if (notified === 'false') {
      query = query.eq('notified', false);
    }

    const { data, error } = await query;
    if (error) throw error;

    const total = data?.length || 0;
    const pending = data?.filter(n => !n.notified).length || 0;
    const sent = data?.filter(n => n.notified).length || 0;

    res.json({
      success: true,
      count: total,
      stats: { total, pending, sent },
      list: data || []
    });

  } catch (err) {
    console.error('Get notify list error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Send Notification
// ============================================
exports.sendNotification = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { message } = req.body;

    const { data: pending } = await supabase
      .from('notify_list')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('notified', false);

    if (!pending || pending.length === 0) {
      return res.json({
        success: true,
        message: 'No pending notifications',
        sent_count: 0
      });
    }

    const notifications = pending.map(item => ({
      mobile: item.mobile,
      message: message || 'PUJA RESTAURANT is now open! 🎉 Order now.',
      sent_at: new Date().toISOString()
    }));

    console.log('📲 Notifications to send:');
    notifications.forEach(n => {
      console.log(`   → ${n.mobile}: ${n.message}`);
    });

    const mobiles = pending.map(p => p.mobile);
    await supabase
      .from('notify_list')
      .update({ notified: true })
      .eq('restaurant_id', restaurant_id)
      .in('mobile', mobiles);

    res.json({
      success: true,
      message: 'Notifications sent (mock)',
      sent_count: notifications.length,
      notifications
    });

  } catch (err) {
    console.error('Send notification error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Delete Entry
// ============================================
exports.deleteNotifyEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { restaurant_id } = req.user;

    const { error } = await supabase
      .from('notify_list')
      .delete()
      .eq('id', id)
      .eq('restaurant_id', restaurant_id);

    if (error) throw error;

    res.json({ success: true, message: 'Removed' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Clear Notified
// ============================================
exports.clearNotified = async (req, res) => {
  try {
    const { restaurant_id } = req.user;

    const { data, error } = await supabase
      .from('notify_list')
      .delete()
      .eq('restaurant_id', restaurant_id)
      .eq('notified', true)
      .select();

    if (error) throw error;

    res.json({
      success: true,
      deleted_count: data?.length || 0
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};