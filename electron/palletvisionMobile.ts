import { readFileSync } from 'node:fs';
import path from 'node:path';

let _mobilePage: string | null = null;

export const mobilePage = (() => {
  if (!_mobilePage) {
    _mobilePage = readFileSync(path.join(__dirname, 'palletvisionMobile.html'), 'utf8');
  }
  return _mobilePage;
})();
