import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { extractPalletVideoFrames } from '../electron/palletvisionFrames';

test('frame selection includes the beginning, middle and end of the recording', async () => {
  await mkdir(path.resolve('.cache'), { recursive: true });
  const root = await mkdtemp(path.resolve('.cache/frame-coverage-'));
  const decoder = require('ffmpeg-static') as string;
  const exec = promisify(execFile);
  try {
    const video = path.join(root, 'positions.webm');
    const frames = path.join(root, 'frames');
    await mkdir(frames);
    await exec(decoder, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=red:s=64x64:r=30:d=2',
      '-f', 'lavfi', '-i', 'color=lime:s=64x64:r=30:d=2', '-f', 'lavfi', '-i', 'color=blue:s=64x64:r=30:d=2',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0', '-c:v', 'libvpx', video], { windowsHide: true });
    const sampling = await extractPalletVideoFrames(decoder, video, frames);
    expect(sampling.durationSeconds).toBeCloseTo(6, 1);
    expect(await readdir(frames)).toHaveLength(15);
    for (const [number, channel] of [[1, 0], [8, 1], [15, 2]]) {
      const { stdout } = await exec(decoder, ['-hide_banner', '-loglevel', 'error', '-i',
        path.join(frames, `frame_${String(number).padStart(4, '0')}.jpg`),
        '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', windowsHide: true });
      expect(stdout[channel]).toBeGreaterThan(200);
      expect(stdout[(channel + 1) % 3]).toBeLessThan(40);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
