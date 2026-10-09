export type CounterSession = { sessionId: string; value: number };
export type Operation = 'counter.open' | 'counter.increment' | 'counter.close' | 'pallet.prepare' | 'pallet.preview' | 'pallet.alignment';
export interface ToolkitAPI {
  freight(action: 'status' | 'choose' | 'create' | 'reupload' | 'open' | 'setTailscale', data?: { company?: string; date?: string; id?: string; enabled?: boolean }): Promise<FreightState>;
  updates(action: 'status' | 'check' | 'download' | 'install'): Promise<UpdateState>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
  previewPalletLabels(job: PalletPrintJob): Promise<PalletPreview>;
  printAlignmentTest(printerName: string): Promise<{ labelCount: number }>;
  listPrinters(): Promise<SystemPrinter[]>;
  printPalletLabels(job: PalletPrintJob): Promise<{ labelCount: number }>;
  openCounter(): Promise<CounterSession>;
  incrementCounter(sessionId: string): Promise<CounterSession>;
  closeCounter(sessionId: string): Promise<{ closed: boolean }>;
  onBackendFailure(callback: () => void): () => void;
}
export type SystemPrinter = { name: string; displayName: string };
export type UpdateState = {
  status: 'disabled' | 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
};
export type PalletPrintJob = { company: string; total: number; printerName: string };
declare global { interface Window { toolkit: ToolkitAPI } }

export type PalletPreview = { company: string; labels: string[]; labelCount: number; lastLabel: string };

export type FreightState = { root: string; running: boolean; error: string; addresses: string[]; useTailscale: boolean; tailscale: { available: boolean; address?: string; hostname?: string; error?: string }; masterUrl: string; masterQr: string; shipments: { id: string; company: string; date: string; folder: string; closed: boolean; reupload: boolean; pictures: number; url: string; qr: string }[] };
