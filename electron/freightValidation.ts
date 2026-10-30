export const MAX_FREIGHT_PICTURES = 26;

function hasJpegEndMarker(bytes: Buffer) {
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true;
  }
  return false;
}

function detectJpeg(bytes: Buffer) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && hasJpegEndMarker(bytes);
}

function detectPng(bytes: Buffer) {
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8, first = true;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
      if (length > bytes.length - offset - 12) break;
      if (first && (type !== 'IHDR' || length !== 13 || !bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12))) break;
      first = false; offset += length + 12;
      if (type === 'IEND') return length === 0;
    }
  }
  return false;
}

function detectGif(bytes: Buffer) {
  return bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) && bytes.readUInt16LE(6) > 0 && bytes.readUInt16LE(8) > 0 && bytes[bytes.length - 1] === 0x3b;
}

function detectWebp(bytes: Buffer) {
  return bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.readUInt32LE(4) + 8 === bytes.length && bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16));
}

function detectBmp(bytes: Buffer) {
  return bytes.length >= 26 && bytes.toString('ascii', 0, 2) === 'BM' && bytes.readUInt32LE(2) === bytes.length && bytes.readUInt32LE(10) >= 26 && bytes.readUInt32LE(10) < bytes.length;
}

function detectTiff(bytes: Buffer) {
  const little = bytes.length >= 8 && bytes.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0]));
  const big = bytes.length >= 8 && bytes.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42]));
  if (little || big) {
    const offset = little ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4);
    if (offset >= 8 && offset + 2 <= bytes.length) {
      const entries = little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
      return entries > 0 && offset + 2 + entries * 12 + 4 <= bytes.length;
    }
  }
  return false;
}

function detectHeif(bytes: Buffer): '.heic' | '.heif' | '.avif' | null {
  const avifBrands = ['avif', 'avis'];
  const heicBrands = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'];
  const heifBrands = ['mif1', 'msf1'];
  let offset = 0, brand = false, metadata = false, payload = false, ext: '.heic' | '.heif' | '.avif' | null = null;
  while (offset + 8 <= bytes.length) {
    let length = bytes.readUInt32BE(offset); const type = bytes.toString('ascii', offset + 4, offset + 8); let header = 8;
    if (length === 1) { if (offset + 16 > bytes.length) break; const large = bytes.readBigUInt64BE(offset + 8); if (large > BigInt(bytes.length)) break; length = Number(large); header = 16; }
    if (length === 0) length = bytes.length - offset;
    if (length < header || length > bytes.length - offset) break;
    if (type === 'ftyp' && length >= header + 8) {
      const brands = [bytes.toString('ascii', offset + header, offset + header + 4)];
      for (let i = offset + header + 8; i + 4 <= offset + length; i += 4) brands.push(bytes.toString('ascii', i, i + 4));
      if (brands.some(b => avifBrands.includes(b))) { brand = true; ext = '.avif'; }
      else if (brands.some(b => heicBrands.includes(b))) { brand = true; ext = '.heic'; }
      else if (brands.some(b => heifBrands.includes(b))) { brand = true; ext = '.heif'; }
    }
    if (type === 'meta' && length > header + 4) metadata = true;
    if ((type === 'mdat' || type === 'meta') && length > header + 4) payload = true;
    offset += length;
  }
  return brand && metadata && payload ? ext : null;
}

function detectFreightImageExtension(bytes: Buffer): string | null {
  if (detectJpeg(bytes)) return '.jpg';
  if (detectPng(bytes)) return '.png';
  if (detectGif(bytes)) return '.gif';
  if (detectWebp(bytes)) return '.webp';
  if (detectBmp(bytes)) return '.bmp';
  if (detectTiff(bytes)) return '.tiff';
  return detectHeif(bytes);
}

// Check file signatures and basic container structure without converting original bytes.
export function validateFreightImage(bytes: Buffer, _name: string) {
  const detected = detectFreightImageExtension(bytes);
  if (!detected) throw new Error('This file is not a valid image matching its filename. Remove it and choose an original picture.');
  return detected;
}
