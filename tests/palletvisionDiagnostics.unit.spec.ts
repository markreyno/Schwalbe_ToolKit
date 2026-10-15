import { test, expect } from '@playwright/test';
import { humanizeLogEntry } from '../electron/palletvisionDiagnostics';

test('humanizeLogEntry describes camera client failures', () => {
  const line = humanizeLogEntry({
    ts: '2026-01-01T12:00:00.000Z',
    event: 'client_camera',
    outcome: 'failure',
    message: 'navigator.mediaDevices unavailable',
    captureId: 'cap_test'
  });
  expect(line).toContain('camera');
  expect(line).toContain('cap_test');
});
