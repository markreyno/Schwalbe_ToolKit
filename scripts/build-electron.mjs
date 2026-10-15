import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
await build({ entryPoints: ['electron/main.ts', 'electron/preload.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: 'dist-electron', outExtension: { '.js': '.cjs' }, external: ['electron', 'electron-updater'], sourcemap: true });
await mkdir('dist-electron', { recursive: true });
await copyFile('electron/palletvisionMobile.html', 'dist-electron/palletvisionMobile.html');
await copyFile('electron/palletvisionMobile.js', 'dist-electron/palletvisionMobile.js');
