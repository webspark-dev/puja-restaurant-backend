const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const supabase = require('./config/database');
const paymentController = require('./controllers/paymentController');

const app = express();
const server = http.createServer(app);

// ============================================
// Socket.IO Setup
// ============================================
const allowedOrigins = (process.env.FRONTEND_URL || '*').split(',');

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});
// Global io for jobs
global.io = io;
app.set('io', io);

require('./websocket/socket')(io);
// ============================================
// Cron Jobs (Automation)
// ============================================
require('./jobs/cashTimeout')();
require('./jobs/sessionCleanup')();
require('./jobs/autoSchedule')();
require('./jobs/daybookArchive')();

// ============================================
// Middleware
// ============================================
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// ============================================
// Webhook (raw body — সবার আগে)
// ============================================
app.post(
  '/api/payment/webhook',
  express.raw({ type: '*/*' }),
  (req, res, next) => {
    req.rawBody = req.body.toString('utf-8');
    next();
  },
  paymentController.webhook
);

app.use(express.json());

// ============================================
// Routes
// ============================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/customer', require('./routes/customer'));
app.use('/api/order', require('./routes/order'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/bill', require('./routes/bill'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/notify', require('./routes/notify'));
app.use('/api/reports', require('./routes/report'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/backup', require('./routes/backup'));
// ============================================
// Health Check
// ============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    websocket: 'enabled',
    port: process.env.PORT || 5000
  });
});

app.get('/db-test', async (req, res) => {
  try {
    const { data } = await supabase.from('restaurants').select('*');
    res.json({ status: 'ok', restaurants: data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ============================================
// Start Server
// ============================================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`✅ WebSocket: ws://localhost:${PORT}`);
  console.log(`✅ Login: POST http://localhost:${PORT}/api/auth/login`);
  console.log(`✅ UPI: POST http://localhost:${PORT}/api/payment/initiate-upi`);
  console.log(`✅ Webhook: POST http://localhost:${PORT}/api/payment/webhook`);
});