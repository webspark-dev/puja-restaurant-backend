const router = require('express').Router();
const menuController = require('../controllers/menuController');
const { authenticate, authorize } = require('../middleware/auth');
const multer = require('multer');
// ============================================
// PUBLIC (Customer)
// ============================================
router.get('/', menuController.getMenu);
router.get('/search', menuController.searchMenu);
router.get('/featured', menuController.getFeaturedItems);
router.get('/item/:id', menuController.getItem);

// ============================================
// ADMIN: Menu Items CRUD
// ============================================
router.post('/items',
  authenticate,
  authorize('owner', 'manager'),
  menuController.createItem
);

router.put('/items/:id',
  authenticate,
  authorize('owner', 'manager'),
  menuController.updateItem
);

router.delete('/items/:id',
  authenticate,
  authorize('owner', 'manager'),
  menuController.deleteItem
);

router.patch('/items/:id/toggle',
  authenticate,
  authorize('owner', 'manager'),
  menuController.toggleAvailability
);

// ============================================
// ADMIN: Categories CRUD
// ============================================
router.get('/categories',
  authenticate,
  authorize('owner', 'manager'),
  menuController.getCategories
);

router.post('/categories',
  authenticate,
  authorize('owner', 'manager'),
  menuController.createCategory
);

router.put('/categories/:id',
  authenticate,
  authorize('owner', 'manager'),
  menuController.updateCategory
);

router.delete('/categories/:id',
  authenticate,
  authorize('owner', 'manager'),
  menuController.deleteCategory
);
// ============================================
// Multer Setup (memory storage)
// ============================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images allowed'), false);
    }
  }
});

// ============================================
// ADMIN: Image Upload Routes
// ============================================
router.post('/upload-image',
  authenticate,
  authorize('owner', 'manager'),
  upload.single('image'),
  menuController.uploadImage
);

router.post('/delete-image',
  authenticate,
  authorize('owner', 'manager'),
  menuController.deleteImage
);
module.exports = router;