import { test, expect } from '@playwright/test';
import { isAllowedHubHost, resolveConnectPwaTools, rewriteToolUrlForHost } from '../electron/toolPhoneUrls';

test.describe('toolPhoneUrls host resolution', () => {
  test('rewrites using matching LAN address from tool status list', () => {
    const addresses = ['http://192.168.4.10:48731', 'http://10.0.0.5:48731'];
    const url = rewriteToolUrlForHost('http://10.0.0.5:48731/?key=ship-token', '192.168.4.10', 48731, addresses);
    expect(url).toBe('http://192.168.4.10:48731/?key=ship-token');
  });

  test('rewrites using Tailscale hostname when phone host matches MagicDNS', () => {
    const addresses = ['http://desk-pc.tailnet.ts.net:48732'];
    const url = rewriteToolUrlForHost('http://desk-pc.tailnet.ts.net:48732/', 'desk-pc.tailnet.ts.net', 48732, addresses);
    expect(url).toBe('http://desk-pc.tailnet.ts.net:48732/');
  });

  test('falls back to request host when not in address list', () => {
    const url = rewriteToolUrlForHost('http://100.64.0.8:48731/?key=master', '100.64.0.8', 48731, ['http://192.168.1.20:48731']);
    expect(url).toBe('http://100.64.0.8:48731/?key=master');
  });

  test('resolveConnectPwaTools embeds shipment key for open freight on LAN host', () => {
    const tools = resolveConnectPwaTools('192.168.1.50', {
      root: '/data',
      running: true,
      addresses: ['http://192.168.1.50:48731'],
      masterUrl: 'http://192.168.1.50:48731/?key=master-key',
      shipments: [{ closed: false, url: 'http://192.168.1.50:48731/?key=shipment-key' }]
    }, {
      root: '/pv',
      running: true,
      addresses: ['http://192.168.1.50:48732'],
      qrUrl: 'http://192.168.1.50:48732/'
    });
    expect(tools[0].ready).toBe(true);
    expect(tools[0].url).toBe('http://192.168.1.50:48731/?key=shipment-key');
    expect(tools[1].url).toBe('http://192.168.1.50:48732/');
  });

  test('resolveConnectPwaTools uses Tailscale host for palletvision when requested', () => {
    const tools = resolveConnectPwaTools('desk.tailnet.ts.net', {
      root: '/data',
      running: true,
      addresses: ['http://desk.tailnet.ts.net:48731'],
      masterUrl: 'http://desk.tailnet.ts.net:48731/?key=m',
      shipments: [{ closed: false, url: 'http://desk.tailnet.ts.net:48731/?key=s' }]
    }, {
      root: '/pv',
      running: true,
      addresses: ['http://desk.tailnet.ts.net:48732'],
      qrUrl: 'http://desk.tailnet.ts.net:48732/'
    });
    expect(tools[1].url).toBe('http://desk.tailnet.ts.net:48732/');
  });

  test('freight not ready without open shipment', () => {
    const tools = resolveConnectPwaTools('192.168.1.50', {
      root: '/data',
      running: true,
      addresses: ['http://192.168.1.50:48731'],
      masterUrl: 'http://192.168.1.50:48731/?key=master-key',
      shipments: [{ closed: true, url: 'http://192.168.1.50:48731/?key=old' }]
    }, {
      root: '/pv',
      running: true,
      addresses: ['http://192.168.1.50:48732'],
      qrUrl: 'http://192.168.1.50:48732/'
    });
    expect(tools[0].ready).toBe(false);
    expect(tools[0].message).toContain('shipment');
  });

  test('isAllowedHubHost accepts private IPs and hostnames', () => {
    expect(isAllowedHubHost('192.168.0.4')).toBe(true);
    expect(isAllowedHubHost('100.64.0.2')).toBe(true);
    expect(isAllowedHubHost('desk.tailnet.ts.net')).toBe(true);
    expect(isAllowedHubHost('')).toBe(false);
  });
});
