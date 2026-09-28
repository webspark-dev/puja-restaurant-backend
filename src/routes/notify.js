const router = require('express').Router();
const notifyController = require('../controllers/notifyController');
const { authenticate, authorize } = require('../middleware/auth');

// PUBLIC (Customer)
router.post('/add', notifyController.addToNotifyList);

// ADMIN
router.get('/list',
  authenticate,
  authorize('owner', 'manager'),
  notifyController.getNotifyList
);

router.post('/send',
  authenticate,
  authorize('owner', 'manager'),
  notifyController.sendNotification
);

router.delete('/:id',
  authenticate,
  authorize('owner', 'manager'),
  notifyController.deleteNotifyEntry
);

router.delete('/clear/notified',
  authenticate,
  authorize('owner', 'manager'),
  notifyController.clearNotified
);

module.exports = router;