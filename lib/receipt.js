async function validateReceipt(value) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || ''));
  if (!match || match[2].length % 4) throw Object.assign(new Error('Upload a valid JPG, PNG, or WebP payment receipt.'), { status: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 2 * 1024 * 1024) throw Object.assign(new Error('Payment proof must be 2 MB or smaller.'), { status: 413 });
  try {
    const metadata = await require('sharp')(bytes, { limitInputPixels: 16000000 }).metadata();
    if (metadata.format !== match[1] || !metadata.width || !metadata.height) throw new Error('Invalid image');
  } catch { throw Object.assign(new Error('This receipt image is damaged or unsupported. Upload the original JPG, PNG, or WebP image.'), { status: 400 }); }
}
module.exports = { validateReceipt };
