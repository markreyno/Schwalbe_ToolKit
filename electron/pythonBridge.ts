import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { Operation } from '../shared/protocol';

export class PythonBridge {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  constructor(private command: string, private args: string[], private onFailure: () => void) {}
  private start() {
    if (this.child) return;
    const child = spawn(this.command, this.args, { windowsHide: true, stdio: 'pipe' });
    this.child = child;
    const fail = () => { if (this.child === child) this.stop(true); };
    child.on('error', fail);
    child.on('exit', fail);
    child.stdin.on('error', fail);
    child.stderr.on('data', data => console.error('[Python]', data.toString()));
    createInterface({ input: child.stdout }).on('line', line => {
      if (this.child !== child) return;
      try {
        const message = JSON.parse(line);
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.result);
      } catch { fail(); }
    });
  }
  request(operation: Operation, sessionId?: string, payload?: unknown): Promise<any> {
    this.start();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => this.stop(true), 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, operation, sessionId, payload }) + '\n', error => {
        if (error) this.stop(true);
      });
    });
  }
  stop(failed = false) {
    const child = this.child;
    this.child = undefined;
    child?.kill();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('The Python tool is unavailable. Try again to reconnect.'));
    }
    this.pending.clear();
    if (failed) this.onFailure();
  }
}
