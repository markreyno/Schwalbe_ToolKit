import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);
const options = { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 };
const seconds = (match: RegExpMatchArray) => Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);

export async function extractPalletVideoFrames(decoder: string, video: string, folder: string, count = 15) {
  let details = '';
  try {
    details = (await exec(decoder, ['-hide_banner', '-i', video], options)).stderr;
  } catch (error) {
    // FFmpeg reports metadata on stderr, then exits because no output was supplied.
    const stderr = (error as { stderr?: string }).stderr;
    if (!stderr) throw error;
    details = stderr;
  }
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(details);
  let duration = match ? seconds(match) : 0;
  if (!(duration > 0)) {
    // Browser WebM recordings can omit container duration. Decode to discover it.
    const decoded = await exec(decoder, ['-hide_banner', '-i', video, '-map', '0:v:0', '-an', '-f', 'null', '-'], options);
    const last = [...decoded.stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].at(-1);
    duration = last ? seconds(last) : 0;
  }
  if (!(duration > 0)) throw new Error('Could not determine video duration for frame selection.');
  // Select across the whole walk; VFR prevents duplication to the input frame rate.
  await exec(decoder, ['-hide_banner', '-nostdin', '-y', '-i', video, '-map', '0:v:0',
    '-vf', `fps=${count / duration},scale=640:-1`, '-fps_mode', 'vfr',
    '-frames:v', String(count), '-q:v', '2', path.join(folder, 'frame_%04d.jpg')], options);
  return { strategy: 'uniform_full_video', durationSeconds: duration, intervalSeconds: duration / count };
}
