import { readFileSync } from 'node:fs';
import path from 'node:path';

export const mobilePage = readFileSync(path.join(__dirname, 'palletvisionMobile.html'), 'utf8');
