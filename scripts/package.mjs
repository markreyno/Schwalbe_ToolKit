import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { build, Platform, Arch } from 'electron-builder';
if (process.platform !== 'win32') throw new Error('Run Windows packaging on Windows.');
const python = process.env.PYTHON_PATH || (existsSync('.venv/Scripts/python.exe') ? path.resolve('.venv/Scripts/python.exe') : 'python');
process.env.PYINSTALLER_CONFIG_DIR = path.resolve('.cache/pyinstaller');
const result = spawnSync(python, ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'toolkit-backend', '--distpath', 'build/python', '--workpath', 'build/pyinstaller', '--specpath', 'build', 'python/main.py'], { stdio: 'inherit', windowsHide: true });
if (result.status !== 0) throw new Error('Python bundling failed. Install python/requirements.txt into .venv first.');
process.env.ELECTRON_BUILDER_CACHE = path.resolve('.cache/electron-builder');
await build({
  targets: Platform.WINDOWS.createTarget(process.argv.includes('--dir') ? 'dir' : 'nsis', Arch.x64),
  publish: 'never',
  ...(process.env.TOOLKIT_OUTPUT_DIR ? { config: { directories: { output: process.env.TOOLKIT_OUTPUT_DIR } } } : {})
});
