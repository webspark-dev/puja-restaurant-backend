const sharp = require('sharp');
const crypto = require('crypto');

// ============================================
// Process image: resize + WebP + thumbnail
// ============================================
exports.processImage = async (buffer, itemName) => {
  try {
    console.log(`🖼️ Processing image: ${itemName}`);

    // Generate unique slug
    const slug = (itemName || 'item')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 30) || 'item';

    const uniqueId = crypto.randomBytes(4).toString('hex');
    const folderName = `${slug}-${uniqueId}`;

    // 1. Main Image (800×600, WebP)
    const mainBuffer = await sharp(buffer)
      .resize(800, 600, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: true
      })
      .webp({ quality: 82 })
      .toBuffer();

    // 2. Thumbnail (400×300, WebP)
    const thumbBuffer = await sharp(buffer)
      .resize(400, 300, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: true
      })
      .webp({ quality: 75 })
      .toBuffer();

    // 3. Original metadata
    const metadata = await sharp(buffer).metadata();

    console.log(`   Original: ${metadata.width}×${metadata.height} | ${(buffer.length / 1024).toFixed(1)} KB`);
    console.log(`   Main:     800×600 WebP | ${(mainBuffer.length / 1024).toFixed(1)} KB`);
    console.log(`   Thumb:    400×300 WebP | ${(thumbBuffer.length / 1024).toFixed(1)} KB`);

    return {
      folderName,
      mainBuffer,
      thumbBuffer,
      originalSize: buffer.length,
      mainSize: mainBuffer.length,
      thumbSize: thumbBuffer.length,
      originalWidth: metadata.width,
      originalHeight: metadata.height
    };

  } catch (err) {
    console.error('Image processing error:', err);
    throw err;
  }
};