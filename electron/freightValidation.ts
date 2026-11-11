import type { FileHandle } from 'node:fs/promises';

export const MAX_FREIGHT_PICTURES = 26;

// Read only container headers and markers. The same checks run for buffers and files.
function* imageStructure(size: number): Generator<[number, number], string | null, Buffer> {
  const head = yield [0, Math.min(size, 26)];
  if (size >= 4 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    let previous = 0;
    for (let start = 0; start < size; start += 65536) {
      const chunk = yield [start, Math.min(65536, size - start)];
      for (const byte of chunk) {
        if (previous === 0xff && byte === 0xd9) return '.jpg';
        previous = byte;
      }
    }
    return null;
  }
  if (size >= 45 && head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    let offset = 8;
    while (offset + 12 <= size) {
      const chunk = yield [offset, offset === 8 ? 16 : 8];
      const length = chunk.readUInt32BE();
      const type = chunk.toString('ascii', 4, 8);
      if (length > size - offset - 12) return null;
      if (offset === 8 && (type !== 'IHDR' || length !== 13 || !chunk.readUInt32BE(8) || !chunk.readUInt32BE(12))) return null;
      offset += length + 12;
      if (type === 'IEND') return length === 0 ? '.png' : null;
    }
    return null;
  }
  if (size >= 14 && ['GIF87a','GIF89a'].includes(head.toString('ascii',0,6)) && head.readUInt16LE(6) && head.readUInt16LE(8)) {
    return (yield [size - 1, 1])[0] === 0x3b ? '.gif' : null;
  }
  if (size >= 20 && head.toString('ascii',0,4) === 'RIFF' && head.readUInt32LE(4) + 8 === size && head.toString('ascii',8,12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(head.toString('ascii',12,16))) return '.webp';
  if (size >= 26 && head.toString('ascii',0,2) === 'BM' && head.readUInt32LE(2) === size && head.readUInt32LE(10) >= 26 && head.readUInt32LE(10) < size) return '.bmp';
  const little = head.subarray(0,4).equals(Buffer.from([73,73,42,0]));
  if (size >= 8 && (little || head.subarray(0,4).equals(Buffer.from([77,77,0,42])))) {
    const offset = little ? head.readUInt32LE(4) : head.readUInt32BE(4);
    if (offset < 8 || offset + 2 > size) return null;
    const count = yield [offset, 2];
    const entries = little ? count.readUInt16LE() : count.readUInt16BE();
    return entries > 0 && offset + 2 + entries * 12 + 4 <= size ? '.tiff' : null;
  }

  const avif = ['avif','avis'];
  const heic = ['heic','heix','hevc','hevx','heim','heis','hevm','hevs'];
  const heif = ['mif1','msf1'];
  let offset = 0, detected: string | null = null, metadata = false;
  while (offset + 8 <= size) {
    const box = yield [offset, 8];
    let length = box.readUInt32BE();
    const type = box.toString('ascii',4,8);
    let header = 8;
    if (length === 1) {
      if (offset + 16 > size) break;
      const large = (yield [offset + 8, 8]).readBigUInt64BE();
      if (large > BigInt(size)) break;
      length = Number(large);
      header = 16;
    } else if (length === 0) {
      length = size - offset;
    }
    if (length < header || length > size - offset) break;
    if (type === 'ftyp' && length >= header + 8) {
      const major = (yield [offset + header, 4]).toString('ascii');
      let hasAvif = avif.includes(major), hasHeic = heic.includes(major), hasHeif = heif.includes(major);
      const end = offset + length;
      for (let start = offset + header + 8; start + 4 <= end; start += 4096) {
        const brands = yield [start, Math.min(4096, end - start)];
        for (let i = 0; i + 4 <= brands.length; i += 4) {
          const compatible = brands.toString('ascii',i,i+4);
          hasAvif ||= avif.includes(compatible);
          hasHeic ||= heic.includes(compatible);
          hasHeif ||= heif.includes(compatible);
        }
      }
      detected = hasAvif ? '.avif' : hasHeic ? '.heic' : hasHeif ? '.heif' : detected;
    }
    if (type === 'meta' && length > header + 4) metadata = true;
    offset += length;
  }
  return metadata ? detected : null;
}

function requireImage<T>(valid: T): NonNullable<T> {
  if (!valid) throw new Error('This file is not a valid image matching its filename. Remove it and choose an original picture.');
  return valid;
}

export function validateFreightImage(bytes: Buffer, _name: string) {
  const check = imageStructure(bytes.length);
  let next = check.next();
  while (!next.done) {
    const [offset, length] = next.value;
    next = check.next(bytes.subarray(offset, offset + length));
  }
  return requireImage(next.value);
}

export async function validateFreightImageFile(file: FileHandle, size: number) {
  const check = imageStructure(size);
  let next = check.next();
  while (!next.done) {
    const [offset, length] = next.value;
    const bytes = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await file.read(bytes, read, length - read, offset + read);
      requireImage(bytesRead > 0);
      read += bytesRead;
    }
    next = check.next(bytes);
  }
  return requireImage(next.value);
}
