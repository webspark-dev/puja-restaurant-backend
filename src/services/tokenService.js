const supabase = require('../config/database');

// প্রতিদিন reset: D001, T001
exports.generateToken = async (restaurantId, orderType) => {
  const prefix = orderType === 'dinein' ? 'D' : 'T';
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('orders')
    .select('token')
    .eq('restaurant_id', restaurantId)
    .eq('order_type', orderType)
    .gte('created_at', today.toISOString())
    .not('token', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  let nextNum = 1;
  if (data && data.length > 0 && data[0].token) {
    const lastNum = parseInt(data[0].token.substring(1));
    nextNum = lastNum + 1;
  }

  return prefix + String(nextNum).padStart(3, '0');
};

// Order number: ORD-20260927-00001
exports.generateOrderNumber = async (restaurantId) => {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
  today.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .gte('created_at', today.toISOString());

  const num = String((count || 0) + 1).padStart(5, '0');
  return `ORD-${dateStr}-${num}`;
};