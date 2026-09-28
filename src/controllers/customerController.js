const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const supabase = require('../config/database');

// ============================================
// STEP 1: Send OTP
// ============================================
exports.sendOtp = async (req, res) => {
  try {
    const { name, mobile, restaurant_id } = req.body;

    // Validation
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name required (min 2 chars)' });
    }
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({ error: 'Valid 10-digit mobile required' });
    }
    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id required' });
    }

    // Rate limit: same mobile max 3 OTP per minute
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const { count } = await supabase
      .from('customer_otps')
      .select('*', { count: 'exact', head: true })
      .eq('mobile', mobile)
      .gte('created_at', oneMinAgo);

    if (count >= 3) {
      return res.status(429).json({
        error: 'Too many OTP requests. Try after 1 minute.'
      });
    }

    // OTP generate
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expires_at = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    // Delete old unverified OTPs for this mobile
    await supabase
      .from('customer_otps')
      .delete()
      .eq('mobile', mobile)
      .eq('verified', false);

    // Insert new OTP
    const { error } = await supabase
      .from('customer_otps')
      .insert({
        mobile,
        otp,
        name: name.trim(),
        expires_at: expires_at.toISOString()
      });

    if (error) throw error;

    console.log(`📱 OTP for ${mobile}: ${otp}`);
    console.log(`   Expires: ${expires_at.toISOString()}`);

    res.json({
      success: true,
      message: 'OTP sent',
      dev_otp: process.env.NODE_ENV === 'development' ? otp : undefined,
      expires_at
    });

  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// STEP 2: Verify OTP
// ============================================
exports.verifyOtp = async (req, res) => {
  try {
    const { mobile, otp, restaurant_id } = req.body;

    if (!mobile || !otp || !restaurant_id) {
      return res.status(400).json({ error: 'mobile, otp, restaurant_id required' });
    }

    console.log(`🔍 Verify: mobile=${mobile}, otp=${otp}`);

    // Get latest unverified OTPs for this mobile
    const { data: records, error } = await supabase
      .from('customer_otps')
      .select('*')
      .eq('mobile', mobile)
      .eq('verified', false)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('Query error:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!records || records.length === 0) {
      console.log('❌ No records found');
      return res.status(400).json({ error: 'No OTP found. Request new OTP.' });
    }

    console.log(`📋 Found ${records.length} record(s)`);

    // Find matching OTP
    const record = records.find(r => r.otp === String(otp).trim());

    if (!record) {
      console.log('❌ No match');
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Check expiry
    if (new Date(record.expires_at) < new Date()) {
      console.log('❌ Expired');
      return res.status(400).json({ error: 'OTP expired. Request new OTP.' });
    }

    console.log('✅ OTP matched');

    // Mark verified
    await supabase
      .from('customer_otps')
      .update({ verified: true })
      .eq('id', record.id);

    // Cleanup: delete all unverified for this mobile
    await supabase
      .from('customer_otps')
      .delete()
      .eq('mobile', mobile)
      .eq('verified', false);

    // JWT token
    const token = jwt.sign(
      {
        type: 'customer',
        mobile: record.mobile,
        name: record.name,
        restaurant_id
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      customer: {
        name: record.name,
        mobile: record.mobile
      }
    });

  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// Customer: Me (token থেকে info)
// ============================================
exports.me = async (req, res) => {
  try {
    res.json({
      name: req.customer.name,
      mobile: req.customer.mobile,
      restaurant_id: req.customer.restaurant_id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};