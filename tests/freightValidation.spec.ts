import { test, expect } from '@playwright/test';
import { validateFreightImage } from '../electron/freightValidation';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=', 'base64');
test('image validation accepts original PNG and rejects renamed or truncated contents', () => {
  expect(() => validateFreightImage(png, 'pallet.png')).not.toThrow();
  expect(() => validateFreightImage(png, 'pallet.jpg')).toThrow('not a valid image');
  expect(() => validateFreightImage(png.subarray(0, png.length - 3), 'pallet.png')).toThrow('not a valid image');
  for (const ext of ['jpg','png','gif','webp','bmp','tiff','heic','heif','avif','exe']) expect(() => validateFreightImage(Buffer.from('renamed text file'), 'pallet.' + ext)).toThrow('not a valid image');
});
test('image validation distinguishes HEIC and AVIF containers and rejects broken box lengths', () => {
  const box = (name: string, contents: Buffer) => { const b = Buffer.alloc(8 + contents.length); b.writeUInt32BE(b.length); b.write(name, 4); contents.copy(b, 8); return b; };
  const container = (brand: string) => Buffer.concat([box('ftyp', Buffer.concat([Buffer.from(brand), Buffer.alloc(4), Buffer.from(brand)])), box('meta', Buffer.alloc(12)), box('mdat', Buffer.alloc(8))]);
  expect(() => validateFreightImage(container('heic'), 'pallet.heic')).not.toThrow();
  expect(() => validateFreightImage(container('avif'), 'pallet.avif')).not.toThrow();
  expect(() => validateFreightImage(container('avif'), 'pallet.heic')).toThrow();
  expect(() => validateFreightImage(container('heic'), 'pallet.avif')).toThrow();
  expect(() => validateFreightImage(container('heic').subarray(0, 24), 'pallet.heic')).toThrow();
  const broken = container('heic'); broken.writeUInt32BE(0xffffffff); expect(() => validateFreightImage(broken, 'pallet.heic')).toThrow();
});
