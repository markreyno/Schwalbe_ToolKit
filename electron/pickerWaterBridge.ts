import fs from 'node:fs/promises';
import path from 'node:path';
import webpush from 'web-push';
import {
  buildPickerWaterNotifications,
  parsePickers,
  type Picker
} from '../shared/pickerWater';

type PushSubscriptionRecord = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
};

type StoredData = {
  pickers: Picker[];
  vapid?: { publicKey: string; privateKey: string };
  pushSubscriptions?: PushSubscriptionRecord[];
};

export class PickerWaterBridge {
  private pickers: Picker[] = [];
  private vapid: { publicKey: string; privateKey: string } | null = null;
  private subscriptions: PushSubscriptionRecord[] = [];

  constructor(private dataPath: string) {}

  async load() {
    try {
      const data: StoredData = JSON.parse(await fs.readFile(this.dataPath, 'utf8'));
      this.pickers = parsePickers(data.pickers);
      if (data.vapid?.publicKey && data.vapid.privateKey) {
        this.vapid = data.vapid;
      }
      this.subscriptions = Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions.filter(s => s?.endpoint && s.keys?.p256dh && s.keys?.auth) : [];
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (!this.vapid) {
      this.vapid = webpush.generateVAPIDKeys();
      await this.persist();
    }
    if (this.vapid) webpush.setVapidDetails('mailto:support@schwalbe.local', this.vapid.publicKey, this.vapid.privateKey);
  }

  private async persist() {
    await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
    const snapshot: StoredData = {
      pickers: this.pickers,
      vapid: this.vapid ?? undefined,
      pushSubscriptions: this.subscriptions
    };
    const temp = this.dataPath + '.tmp';
    await fs.writeFile(temp, JSON.stringify(snapshot));
    await fs.rename(temp, this.dataPath);
  }

  async sync(pickers: Picker[]) {
    this.pickers = parsePickers(pickers);
    await this.persist();
    await this.sendPushNotifications();
  }

  notifications() {
    return buildPickerWaterNotifications(this.pickers);
  }

  vapidPublicKey() {
    return this.vapid?.publicKey;
  }

  async savePushSubscription(body: unknown) {
    const sub = body as PushSubscriptionRecord & { keys?: { p256dh?: string; auth?: string } };
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Invalid push subscription.');
    const record: PushSubscriptionRecord = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      createdAt: new Date().toISOString()
    };
    this.subscriptions = this.subscriptions.filter(s => s.endpoint !== record.endpoint);
    this.subscriptions.push(record);
    if (this.subscriptions.length > 20) this.subscriptions = this.subscriptions.slice(-20);
    await this.persist();
  }

  private async sendPushNotifications() {
    if (!this.vapid || !this.subscriptions.length) return;
    const { count, items } = this.notifications();
    if (!count) return;
    const payload = JSON.stringify({
      title: count === 1 ? items[0].title : `${count} pickers need water`,
      body: items.map(item => item.pickerName).join(', '),
      url: '/'
    });
    const dead: string[] = [];
    for (const sub of this.subscriptions) {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (e: any) {
        if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub.endpoint);
      }
    }
    if (dead.length) {
      this.subscriptions = this.subscriptions.filter(s => !dead.includes(s.endpoint));
      await this.persist();
    }
  }
}
