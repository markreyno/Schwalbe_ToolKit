import { test, expect } from '@playwright/test';

function isPrivateIP(ip: string): boolean {
  if (ip === '::1') return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  if (parts[0] === 127) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

test.describe('Freight IP validation', () => {
  test('accepts localhost and loopback addresses', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.1.2.3')).toBe(true);
    expect(isPrivateIP('::1')).toBe(true);
  });

  test('accepts RFC1918 private network ranges', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('10.255.255.255')).toBe(true);
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('192.168.0.1')).toBe(true);
    expect(isPrivateIP('192.168.255.255')).toBe(true);
  });

  test('accepts link-local addresses', () => {
    expect(isPrivateIP('169.254.1.1')).toBe(true);
    expect(isPrivateIP('169.254.255.255')).toBe(true);
  });

  test('rejects public IP addresses', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('172.32.0.1')).toBe(false);
    expect(isPrivateIP('172.15.0.1')).toBe(false);
    expect(isPrivateIP('193.168.0.1')).toBe(false);
  });

  test('handles invalid IP addresses', () => {
    expect(isPrivateIP('')).toBe(false);
    expect(isPrivateIP('invalid')).toBe(false);
    expect(isPrivateIP('300.300.300.300')).toBe(false);
    expect(isPrivateIP('1.2.3')).toBe(false);
    expect(isPrivateIP('1.2.3.4.5')).toBe(false);
  });
});
