import { test, expect } from '@playwright/test';
import path from 'node:path';
import { sanitizeFreightUploadFolderName, resolveFreightUploadDirectory } from '../electron/freightFolderName';

test.describe('freight upload folder names', () => {
  const shipmentRoot = path.join('/data', 'freight', 'Acme_2026-01-15');

  test('empty input uses default shipment folder segment', () => {
    expect(sanitizeFreightUploadFolderName('', 'Acme_2026-01-15')).toBe('Acme_2026-01-15');
    expect(resolveFreightUploadDirectory(shipmentRoot, '', 'Acme_2026-01-15')).toBe(shipmentRoot);
  });

  test('custom name creates a subfolder under the shipment directory', () => {
    expect(resolveFreightUploadDirectory(shipmentRoot, 'Dock 3', 'Acme_2026-01-15')).toBe(
      path.join(shipmentRoot, 'Dock 3')
    );
  });

  test('strips path separators and parent segments', () => {
    expect(sanitizeFreightUploadFolderName('..\\..\\evil', 'Acme_2026-01-15')).toBe('evil');
    expect(sanitizeFreightUploadFolderName('Dock/../Trailers', 'Acme_2026-01-15')).toBe('Trailers');
    expect(resolveFreightUploadDirectory(shipmentRoot, '../../outside', 'Acme_2026-01-15')).toBe(
      path.join(shipmentRoot, 'outside')
    );
    expect(resolveFreightUploadDirectory(shipmentRoot, 'Dock/../Trailers', 'Acme_2026-01-15')).toBe(
      path.join(shipmentRoot, 'Trailers')
    );
  });

  test('rejects reserved Windows names', () => {
    expect(() => sanitizeFreightUploadFolderName('CON', 'Acme_2026-01-15')).toThrow(/not allowed/i);
  });

  test('trims and limits length', () => {
    const long = 'a'.repeat(120);
    expect(sanitizeFreightUploadFolderName(long, 'Acme_2026-01-15').length).toBe(80);
  });
});
