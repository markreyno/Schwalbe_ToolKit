import path from 'node:path';

const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

/** Sanitize a single folder segment for picture storage inside a shipment folder. */
export function sanitizeFreightUploadFolderName(input: string, defaultName: string): string {
  let name = (input ?? '').trim();
  if (!name) name = (defaultName ?? '').trim();
  name = name.split(/[/\\]/).filter(Boolean).pop() || name;
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
  name = name.replace(/\.\./g, '');
  name = name.replace(/[.\s]+$/g, '').replace(/^[.\s]+/g, '');
  if (!name) throw new Error('Enter a valid folder name.');
  if (name.length > 80) name = name.slice(0, 80);
  if (RESERVED.has(name.toUpperCase())) throw new Error('That folder name is not allowed on Windows.');
  return name;
}

export function resolveFreightUploadDirectory(shipmentFolder: string, folderNameInput: string, defaultFolderName: string): string {
  const shipmentRoot = path.resolve(shipmentFolder);
  const defaultName = (defaultFolderName ?? '').trim() || path.basename(shipmentRoot);
  const trimmed = (folderNameInput ?? '').trim();
  if (!trimmed || trimmed === defaultName) return shipmentRoot;
  const segment = sanitizeFreightUploadFolderName(folderNameInput, defaultName);
  if (segment === defaultName) return shipmentRoot;
  const target = path.resolve(path.join(shipmentRoot, segment));
  if (target !== shipmentRoot && !target.startsWith(shipmentRoot + path.sep)) {
    throw new Error('Folder name is not allowed.');
  }
  return target;
}
