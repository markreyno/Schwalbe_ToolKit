import { readFileSync } from 'node:fs';
import path from 'node:path';
import { freightLogo } from './freightBrand';

let _mobilePage: string | null = null;

export const mobilePage = (() => {
  if (!_mobilePage) {
    const html = readFileSync(path.join(__dirname, 'palletvisionMobile.html'), 'utf8');
    _mobilePage = html.replace('__BRAND_LOGO__', freightLogo);
  }
  return _mobilePage;
})();
