const sharp = require('sharp');
const jsQR = require('jsqr');

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function normalizeMobile(value) {
  const number = String(value || '').trim().replace(/[\s()-]/g, '');
  if (!number) return '';
  if (/^09\d{9}$/.test(number)) return number;
  if (/^\+?639\d{9}$/.test(number)) return `0${number.replace(/^\+?63/, '')}`;
  invalid('Enter a Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX.');
}

function crc16(value) {
  let crc = 0xffff;
  for (const byte of Buffer.from(value, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function paymentPayload(value) {
  const fields = new Map();
  for (let offset = 0; offset < value.length;) {
    const header = value.slice(offset, offset + 4);
    const length = Number(header.slice(2));
    if (!/^\d{4}$/.test(header) || !length || offset + 4 + length > value.length) invalid('Upload a valid GCash/Maya-compatible QRPh payment QR, not a website or demo QR.');
    const id = header.slice(0, 2);
    if (fields.has(id)) invalid('The payment QR contains duplicate fields.');
    fields.set(id, value.slice(offset + 4, offset + 4 + length));
    offset += 4 + length;
  }
  const account = [...fields].some(([id, data]) => Number(id) >= 26 && Number(id) <= 51 && data.length >= 8);
  if (fields.get('00') !== '01' || fields.get('53') !== '608' || fields.get('58') !== 'PH' || !fields.get('59') || !account || !/6304[\dA-Fa-f]{4}$/.test(value) || crc16(value.slice(0, -4)) !== fields.get('63')?.toUpperCase()) {
    invalid('Upload a valid GCash/Maya-compatible QRPh payment QR with a valid checksum.');
  }
  if (fields.get('01') === '12' || fields.has('54')) invalid('Upload a reusable receive-payment QR, not a temporary or fixed-amount payment QR.');
  return { recipient: fields.get('59'), format: 'QRPh', ownershipVerified: false };
}

async function validateQrImage(image) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(image || ''));
  if (!match) invalid('Payment QR must be a JPG, PNG, or WebP image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 2 * 1024 * 1024) invalid('Payment QR image must be 2 MB or smaller.', 413);
  let pixels;
  try {
    pixels = await sharp(bytes, { limitInputPixels: 16000000 }).rotate().resize({ width: 1500, height: 1500, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch { invalid('The uploaded file is not a readable payment QR image.'); }
  const code = jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height);
  if (!code) invalid('No readable QR code was found. Upload a clear QR downloaded from GCash or Maya.');
  return paymentPayload(code.data);
}

async function sanitizeMethod(method = {}, label, mode) {
  const enabled = method.enabled !== false;
  const accountName = String(method.accountName || '').trim();
  if (accountName.length > 120) invalid(`${label} account name must be 120 characters or shorter.`);
  const accountNumber = normalizeMobile(method.accountNumber);
  const qrImage = String(method.qrImage || '');
  const qrValidation = qrImage ? await validateQrImage(qrImage) : null;
  if (mode === 'live' && enabled && (!accountName || (!accountNumber && !qrImage))) invalid(`${label} needs an account name and a valid mobile number or payment QR.`);
  return { enabled, accountName, accountNumber, qrImage, qrValidation };
}

function realPaymentConfigured(settings) {
  return [settings.gcash, settings.maya].some((method) => method?.enabled && (method.accountNumber || method.qrImage));
}

const demoMethods = Object.fromEntries(['gcash', 'maya'].map((key) => [key, {
  enabled: true, accountName: 'DEMO ONLY - NO MONEY TRANSFER', accountNumber: `DEMO-${key.toUpperCase()}`,
  qrImage: `https://thebarbercoofficial.github.io/barber-co/images/demo-${key}-qr.png`
}]));

module.exports = { normalizeMobile, crc16, paymentPayload, validateQrImage, sanitizeMethod, realPaymentConfigured, demoMethods };
