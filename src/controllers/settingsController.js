const bcrypt = require('bcryptjs');
const supabase = require('../config/database');

// ============================================
// Get Restaurant Info + Settings
// ============================================
exports.getSettings = async (req, res) => {
  try {
    const { restaurant_id } = req.user;

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('*')
      .eq('id', restaurant_id)
      .single();

    const { data: settings } = await supabase
      .from('restaurant_settings')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .single();

    res.json({
      success: true,
      restaurant,
      settings
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Update Restaurant Info
// ============================================
exports.updateRestaurantInfo = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { name, tagline, address, phone, gstin, fssai, logo_url } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (tagline !== undefined) updateData.tagline = tagline;
    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.phone = phone;
    if (gstin !== undefined) updateData.gstin = gstin;
    if (fssai !== undefined) updateData.fssai = fssai;
    if (logo_url !== undefined) updateData.logo_url = logo_url;

    const { data, error } = await supabase
      .from('restaurants')
      .update(updateData)
      .eq('id', restaurant_id)
      .select()
      .single();

    if (error) throw error;

    // Audit log
    await supabase.from('audit_log').insert({
      user_id: req.user.id,
      action: 'UPDATE_RESTAURANT_INFO',
      entity: 'restaurants',
      entity_id: restaurant_id,
      details: updateData
    });

    res.json({ success: true, restaurant: data });
  } catch (err) {
    console.error('Update restaurant error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Update Business Settings
// ============================================
exports.updateBusinessSettings = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const {
      gst_percent,
      cash_timeout_minutes,
      code_enabled,
      current_code,
      code_valid_from,
      code_valid_to
    } = req.body;

    const updateData = { updated_at: new Date().toISOString() };
    if (gst_percent !== undefined) updateData.gst_percent = gst_percent;
    if (cash_timeout_minutes !== undefined) updateData.cash_timeout_minutes = cash_timeout_minutes;
    if (code_enabled !== undefined) updateData.code_enabled = code_enabled;
    if (current_code !== undefined) updateData.current_code = current_code;
    if (code_valid_from !== undefined) updateData.code_valid_from = code_valid_from;
    if (code_valid_to !== undefined) updateData.code_valid_to = code_valid_to;

    const { data, error } = await supabase
      .from('restaurant_settings')
      .update(updateData)
      .eq('restaurant_id', restaurant_id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, settings: data });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Change Password
// ============================================
exports.changePassword = async (req, res) => {
  try {
    const { id: user_id } = req.user;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password required' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Get user
    const { data: user } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', user_id)
      .single();

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Verify current
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new
    const newHash = await bcrypt.hash(new_password, 10);

    await supabase
      .from('users')
      .update({ password_hash: newHash })
      .eq('id', user_id);

    // Audit log
    await supabase.from('audit_log').insert({
      user_id,
      action: 'CHANGE_PASSWORD',
      entity: 'users',
      entity_id: user_id
    });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Get Profile
// ============================================
exports.getProfile = async (req, res) => {
  try {
    const { id: user_id } = req.user;

    const { data } = await supabase
      .from('users')
      .select('id, name, email, phone, role, active, created_at')
      .eq('id', user_id)
      .single();

    res.json({ success: true, user: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Update Profile
// ============================================
exports.updateProfile = async (req, res) => {
  try {
    const { id: user_id } = req.user;
    const { name, phone } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', user_id)
      .select('id, name, email, phone, role')
      .single();

    if (error) throw error;

    res.json({ success: true, user: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Staff Management
// ============================================
exports.getStaff = async (req, res) => {
  try {
    const { restaurant_id } = req.user;

    const { data } = await supabase
      .from('users')
      .select('id, name, email, phone, role, active, created_at')
      .eq('restaurant_id', restaurant_id)
      .order('created_at', { ascending: false });

    res.json({ success: true, staff: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createStaff = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { name, email, phone, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password, role required' });
    }

    if (!['manager', 'cashier', 'kitchen', 'waiter'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Check email exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users')
      .insert({
        restaurant_id,
        name,
        email,
        phone: phone || null,
        password_hash,
        role,
        active: true
      })
      .select('id, name, email, phone, role, active')
      .single();

    if (error) throw error;

    res.json({ success: true, staff: data });
  } catch (err) {
    console.error('Create staff error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.updateStaff = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { id } = req.params;
    const { name, phone, role, active } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (role !== undefined) updateData.role = role;
    if (active !== undefined) updateData.active = active;

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id)
      .eq('restaurant_id', restaurant_id)
      .select('id, name, email, phone, role, active')
      .single();

    if (error) throw error;

    res.json({ success: true, staff: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteStaff = async (req, res) => {
  try {
    const { restaurant_id, id: my_id } = req.user;
    const { id } = req.params;

    if (id === my_id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    await supabase
      .from('users')
      .delete()
      .eq('id', id)
      .eq('restaurant_id', restaurant_id);

    res.json({ success: true, message: 'Staff removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Audit Log
// ============================================
exports.getAuditLog = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { limit = 50 } = req.query;

    // Get users in this restaurant
    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('restaurant_id', restaurant_id);

    if (!users || users.length === 0) {
      return res.json({ success: true, logs: [] });
    }

    const userIds = users.map(u => u.id);

    const { data } = await supabase
      .from('audit_log')
      .select('*')
      .in('user_id', userIds)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    res.json({ success: true, count: data?.length || 0, logs: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};