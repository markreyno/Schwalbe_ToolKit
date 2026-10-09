import path from 'node:path';
export const MAX_FREIGHT_PICTURES = 26;
// Check file signatures and basic container structure without converting original bytes.
export function validateFreightImage(bytes: Buffer, name: string) {
  const extension = path.extname(name).toLowerCase();
  let valid = false;
  if (extension === '.jpg' || extension === '.jpeg') {
    valid = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  } else if (extension === '.png') {
    if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      let offset = 8, first = true;
      while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
        if (length > bytes.length - offset - 12) break;
        if (first && (type !== 'IHDR' || length !== 13 || !bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12))) break;
        first = false; offset += length + 12;
        if (type === 'IEND') { valid = length === 0 && offset === bytes.length; break; }
      }
    }
  } else if (extension === '.gif') {
    valid = bytes.length >= 14 && ['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)) && bytes.readUInt16LE(6) > 0 && bytes.readUInt16LE(8) > 0 && bytes[bytes.length - 1] === 0x3b;
  } else if (extension === '.webp') {
    valid = bytes.length >= 20 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.readUInt32LE(4) + 8 === bytes.length && bytes.toString('ascii',8,12) === 'WEBP' && ['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16));
  } else if (extension === '.bmp') {
    valid = bytes.length >= 26 && bytes.toString('ascii',0,2) === 'BM' && bytes.readUInt32LE(2) === bytes.length && bytes.readUInt32LE(10) >= 26 && bytes.readUInt32LE(10) < bytes.length;
  } else if (extension === '.tif' || extension === '.tiff') {
    const little = bytes.length >= 8 && bytes.subarray(0,4).equals(Buffer.from([73,73,42,0]));
    const big = bytes.length >= 8 && bytes.subarray(0,4).equals(Buffer.from([77,77,0,42]));
    if (little || big) { const offset = little ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4); if (offset >= 8 && offset + 2 <= bytes.length) { const entries = little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset); valid = entries > 0 && offset + 2 + entries * 12 + 4 <= bytes.length; } }
  } else if (['.heic','.heif','.avif'].includes(extension)) {
    let offset = 0, brand = false, metadata = false, payload = false;
    while (offset + 8 <= bytes.length) {
      let length = bytes.readUInt32BE(offset); const type = bytes.toString('ascii',offset + 4,offset + 8); let header = 8;
      if (length === 1) { if (offset + 16 > bytes.length) break; const large = bytes.readBigUInt64BE(offset + 8); if (large > BigInt(bytes.length)) break; length = Number(large); header = 16; }
      if (length === 0) length = bytes.length - offset;
      if (length < header || length > bytes.length - offset) break;
      if (type === 'ftyp' && length >= header + 8) {
        const brands = [bytes.toString('ascii',offset + header,offset + header + 4)];
        for (let i = offset + header + 8; i + 4 <= offset + length; i += 4) brands.push(bytes.toString('ascii',i,i + 4));
        const accepted = extension === '.avif' ? ['avif','avis'] : ['heic','heix','hevc','hevx','heim','heis','hevm','hevs','mif1','msf1'];
        brand = brands.some(b => accepted.includes(b)) && (extension === '.avif' || !brands.some(b => ['avif','avis'].includes(b)));
      }
      if (type === 'meta' && length > header + 4) metadata = true;
      if ((type === 'mdat' || type === 'meta') && length > header + 4) payload = true;
      offset += length;
    }
    valid = brand && metadata && payload && offset === bytes.length;
  }
  if (!valid) throw new Error('This file is not a valid image matching its filename. Remove it and choose an original picture.');
}
