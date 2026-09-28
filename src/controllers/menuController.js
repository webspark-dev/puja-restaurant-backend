const supabase = require('../config/database');
const imageService = require('../services/imageService');
// ============================================
// PUBLIC: Get Full Menu (Customer)
// ============================================
exports.getMenu = async (req, res) => {
  try {
    const { restaurant_id } = req.query;

    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id required' });
    }

    // Restaurant
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('*')
      .eq('id', restaurant_id)
      .single();

    // Settings
    const { data: settings } = await supabase
      .from('restaurant_settings')
      .select('ordering_enabled, pause_message, gst_percent')
      .eq('restaurant_id', restaurant_id)
      .single();

    // Categories
    const { data: categories } = await supabase
      .from('menu_categories')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('active', true)
      .order('display_order');

    // Items
    const { data: items } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('available', true)
      .order('display_order');

    // Variants + Addons for each item
    const itemsWithExtras = await Promise.all((items || []).map(async (item) => {
      const [variantsRes, addonsRes] = await Promise.all([
        supabase
          .from('menu_variants')
          .select('*')
          .eq('menu_item_id', item.id)
          .eq('active', true)
          .order('display_order'),
        supabase
          .from('menu_addons')
          .select('*')
          .eq('menu_item_id', item.id)
          .eq('active', true)
          .order('display_order')
      ]);

      return {
        ...item,
        variants: variantsRes.data || [],
        addons: addonsRes.data || []
      };
    }));

    res.json({
      success: true,
      restaurant,
      categories: categories || [],
      items: itemsWithExtras,
      ordering_enabled: settings?.ordering_enabled ?? true,
      pause_message: settings?.pause_message || null,
      gst_percent: settings?.gst_percent || 5
    });

  } catch (err) {
    console.error('Menu error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// PUBLIC: Search Menu
// ============================================
exports.searchMenu = async (req, res) => {
  try {
    const { restaurant_id, q } = req.query;

    if (!restaurant_id || !q) {
      return res.status(400).json({ error: 'restaurant_id and q required' });
    }

    const { data: items } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('available', true)
      .ilike('name', `%${q}%`)
      .limit(20);

    res.json({
      success: true,
      count: items?.length || 0,
      query: q,
      items: items || []
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// PUBLIC: Featured & Best Seller Items
// ============================================
exports.getFeaturedItems = async (req, res) => {
  try {
    const { restaurant_id } = req.query;

    const { data: featured } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('available', true)
      .eq('is_featured', true)
      .order('display_order')
      .limit(10);

    const { data: bestSellers } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('available', true)
      .eq('is_best_seller', true)
      .order('display_order')
      .limit(10);

    res.json({
      success: true,
      featured: featured || [],
      best_sellers: bestSellers || []
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// PUBLIC: Get Single Item
// ============================================
exports.getItem = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: item, error } = await supabase
      .from('menu_items')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const { data: variants } = await supabase
      .from('menu_variants')
      .select('*')
      .eq('menu_item_id', id)
      .eq('active', true)
      .order('display_order');

    const { data: addons } = await supabase
      .from('menu_addons')
      .select('*')
      .eq('menu_item_id', id)
      .eq('active', true)
      .order('display_order');

    res.json({
      success: true,
      item: {
        ...item,
        variants: variants || [],
        addons: addons || []
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Create Item
// ============================================
exports.createItem = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const {
      name, description, price, category_id, image_url,
      is_veg, is_featured, is_best_seller, prep_time_minutes,
      spice_level_enabled, variants_enabled, addons_enabled,
      variants, addons
    } = req.body;

    if (!name || !price || !category_id) {
      return res.status(400).json({ error: 'name, price, category_id required' });
    }

    const { data: item, error } = await supabase
      .from('menu_items')
      .insert({
        restaurant_id,
        name,
        description: description || '',
        price: parseFloat(price),
        category_id,
        image_url: image_url || null,
        is_veg: is_veg ?? true,
        is_featured: is_featured || false,
        is_best_seller: is_best_seller || false,
        prep_time_minutes: prep_time_minutes || 15,
        spice_level_enabled: spice_level_enabled || false,
        variants_enabled: variants_enabled || false,
        addons_enabled: addons_enabled || false,
        available: true
      })
      .select()
      .single();

    if (error) throw error;

    // Insert variants
    if (variants && variants.length > 0) {
      await supabase.from('menu_variants').insert(
        variants.map((v, idx) => ({
          menu_item_id: item.id,
          name: v.name,
          price: parseFloat(v.price),
          display_order: idx
        }))
      );
    }

    // Insert addons
    if (addons && addons.length > 0) {
      await supabase.from('menu_addons').insert(
        addons.map((a, idx) => ({
          menu_item_id: item.id,
          name: a.name,
          price: parseFloat(a.price),
          display_order: idx
        }))
      );
    }

    console.log(`✅ Menu item created: ${name}`);

    res.json({ success: true, item });

  } catch (err) {
    console.error('Create item error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Update Item
// ============================================
exports.updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { restaurant_id } = req.user;
    const {
      name, description, price, category_id, image_url,
      is_veg, is_featured, is_best_seller, prep_time_minutes,
      spice_level_enabled, variants_enabled, addons_enabled,
      available, variants, addons
    } = req.body;

    // Verify ownership
    const { data: existing } = await supabase
      .from('menu_items')
      .select('id')
      .eq('id', id)
      .eq('restaurant_id', restaurant_id)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Update main item
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (category_id !== undefined) updateData.category_id = category_id;
    if (image_url !== undefined) updateData.image_url = image_url;
    if (is_veg !== undefined) updateData.is_veg = is_veg;
    if (is_featured !== undefined) updateData.is_featured = is_featured;
    if (is_best_seller !== undefined) updateData.is_best_seller = is_best_seller;
    if (prep_time_minutes !== undefined) updateData.prep_time_minutes = prep_time_minutes;
    if (spice_level_enabled !== undefined) updateData.spice_level_enabled = spice_level_enabled;
    if (variants_enabled !== undefined) updateData.variants_enabled = variants_enabled;
    if (addons_enabled !== undefined) updateData.addons_enabled = addons_enabled;
    if (available !== undefined) updateData.available = available;

    const { data: item, error } = await supabase
      .from('menu_items')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Update variants (delete + insert)
    if (variants !== undefined) {
      await supabase.from('menu_variants').delete().eq('menu_item_id', id);
      if (variants.length > 0) {
        await supabase.from('menu_variants').insert(
          variants.map((v, idx) => ({
            menu_item_id: id,
            name: v.name,
            price: parseFloat(v.price),
            display_order: idx
          }))
        );
      }
    }

    // Update addons
    if (addons !== undefined) {
      await supabase.from('menu_addons').delete().eq('menu_item_id', id);
      if (addons.length > 0) {
        await supabase.from('menu_addons').insert(
          addons.map((a, idx) => ({
            menu_item_id: id,
            name: a.name,
            price: parseFloat(a.price),
            display_order: idx
          }))
        );
      }
    }

    console.log(`✅ Menu item updated: ${id}`);

    res.json({ success: true, item });

  } catch (err) {
    console.error('Update item error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Delete Item
// ============================================
exports.deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { restaurant_id } = req.user;

    const { error } = await supabase
      .from('menu_items')
      .delete()
      .eq('id', id)
      .eq('restaurant_id', restaurant_id);

    if (error) throw error;

    console.log(`🗑️ Menu item deleted: ${id}`);

    res.json({ success: true, message: 'Item deleted' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Toggle Availability
// ============================================
exports.toggleAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const { restaurant_id } = req.user;

    const { data: item } = await supabase
      .from('menu_items')
      .select('available')
      .eq('id', id)
      .eq('restaurant_id', restaurant_id)
      .single();

    if (!item) return res.status(404).json({ error: 'Item not found' });

    const { data: updated } = await supabase
      .from('menu_items')
      .update({ available: !item.available })
      .eq('id', id)
      .select()
      .single();

    res.json({
      success: true,
      available: updated.available
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Categories CRUD
// ============================================
exports.getCategories = async (req, res) => {
  try {
    const { restaurant_id } = req.user;

    const { data } = await supabase
      .from('menu_categories')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .order('display_order');

    res.json({ success: true, categories: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { name, display_order } = req.body;

    if (!name) return res.status(400).json({ error: 'name required' });

    const { data, error } = await supabase
      .from('menu_categories')
      .insert({
        restaurant_id,
        name,
        display_order: display_order || 0,
        active: true
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, category: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// ============================================
// ADMIN: Upload Image to Supabase Storage
// ============================================
exports.uploadImage = async (req, res) => {
  try {
    const { restaurant_id } = req.user;
    const { item_name } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Only images allowed' });
    }

    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (max 5 MB)' });
    }

    console.log(`📤 Upload: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);

    // Process image
    const processed = await imageService.processImage(
      req.file.buffer,
      item_name || 'item'
    );

    // Upload main image
    const mainPath = `${processed.folderName}/main.webp`;
    const { error: mainErr } = await supabase.storage
      .from('menu-images')
      .upload(mainPath, processed.mainBuffer, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: false
      });

    if (mainErr) throw mainErr;

    // Upload thumbnail
    const thumbPath = `${processed.folderName}/thumbnail.webp`;
    const { error: thumbErr } = await supabase.storage
      .from('menu-images')
      .upload(thumbPath, processed.thumbBuffer, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: false
      });

    if (thumbErr) throw thumbErr;

    // Get public URLs
    const { data: mainUrl } = supabase.storage
      .from('menu-images')
      .getPublicUrl(mainPath);

    const { data: thumbUrl } = supabase.storage
      .from('menu-images')
      .getPublicUrl(thumbPath);

    console.log(`✅ Uploaded: ${mainPath}`);

    res.json({
      success: true,
      image_url: mainUrl.publicUrl,
      thumbnail_url: thumbUrl.publicUrl,
      stats: {
        original_kb: parseFloat((processed.originalSize / 1024).toFixed(1)),
        main_kb: parseFloat((processed.mainSize / 1024).toFixed(1)),
        thumb_kb: parseFloat((processed.thumbSize / 1024).toFixed(1)),
        original_dimensions: `${processed.originalWidth}×${processed.originalHeight}`
      }
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN: Delete Image
// ============================================
exports.deleteImage = async (req, res) => {
  try {
    const { image_url } = req.body;

    if (!image_url) {
      return res.status(400).json({ error: 'image_url required' });
    }

    // Extract folder name from URL
    const match = image_url.match(/menu-images\/(.+?)\/(main|thumbnail)\.webp/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image URL format' });
    }

    const folder = match[1];

    const { error } = await supabase.storage
      .from('menu-images')
      .remove([`${folder}/main.webp`, `${folder}/thumbnail.webp`]);

    if (error) throw error;

    res.json({ success: true, message: 'Image deleted' });

  } catch (err) {
    console.error('Delete image error:', err);
    res.status(500).json({ error: err.message });
  }
};
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { restaurant_id } = req.user;
    const { name, display_order, active } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (display_order !== undefined) updateData.display_order = display_order;
    if (active !== undefined) updateData.active = active;

    const { data, error } = await supabase
      .from('menu_categories')
      .update(updateData)
      .eq('id', id)
      .eq('restaurant_id', restaurant_id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, category: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { restaurant_id } = req.user;

    // Check if has items
    const { count } = await supabase
      .from('menu_items')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', id);

    if (count > 0) {
      return res.status(400).json({
        error: `Cannot delete. ${count} items in this category.`,
        items_count: count
      });
    }

    await supabase
      .from('menu_categories')
      .delete()
      .eq('id', id)
      .eq('restaurant_id', restaurant_id);

    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};