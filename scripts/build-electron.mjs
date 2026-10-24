import { build } from 'esbuild';
import { copyFile, cp, mkdir } from 'node:fs/promises';
// Keep ffmpeg-static's executable lookup relative to its installed package.
await build({ entryPoints: ['electron/main.ts', 'electron/preload.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: 'dist-electron', outExtension: { '.js': '.cjs' }, external: ['electron', 'electron-updater', 'ffmpeg-static'], sourcemap: true });
await mkdir('dist-electron', { recursive: true });
await copyFile('electron/palletvisionMobile.html', 'dist-electron/palletvisionMobile.html');
await copyFile('electron/palletvisionMobile.js', 'dist-electron/palletvisionMobile.js');
await cp('electron/connectPwa', 'dist-electron/connectPwa', { recursive: true });
