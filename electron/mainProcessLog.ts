import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

let logPath = '';
let activitySink: ((summary: string) => void) | null = null;
let registered = false;

function formatReason(reason: unknown) {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack}` : ''}`;
  return String(reason);
}

export function registerMainProcessErrorHandlers(onActivity?: (summary: string) => void) {
  if (onActivity) activitySink = onActivity;
  if (registered) return;
  registered = true;
  logPath = path.join(app.getPath('userData'), 'main-process-errors.log');

  const record = (label: string, reason: unknown) => {
    const summary = `[${new Date().toISOString()}] ${label} ${formatReason(reason)}`;
    console.error(summary);
    void fs.appendFile(logPath, summary + '\n').catch(() => {});
    activitySink?.(summary);
  };

  process.on('uncaughtException', (error) => {
    record('uncaughtException', error);
  });
  process.on('unhandledRejection', (reason) => {
    record('unhandledRejection', reason);
  });
}

export function mainProcessLogPath() {
  return logPath || path.join(app.getPath('userData'), 'main-process-errors.log');
}
