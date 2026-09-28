// ============================================
// WebSocket Handler — Real-time updates
// ============================================
module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    // Customer — order tracker join
    socket.on('track:order', (orderId) => {
      socket.join(`order:${orderId}`);
      console.log(`📍 Customer joined tracker: ${orderId}`);
    });

    socket.on('untrack:order', (orderId) => {
      socket.leave(`order:${orderId}`);
    });

    // Admin — join admin room
    socket.on('admin:join', () => {
      socket.join('admin');
      console.log('👨‍💼 Admin joined');
    });

    // Kitchen — join kitchen room
    socket.on('kitchen:join', () => {
      socket.join('kitchen');
      console.log('👨‍🍳 Kitchen joined');
    });

    socket.on('disconnect', () => {
      console.log('🔌 Client disconnected:', socket.id);
    });
  });
};