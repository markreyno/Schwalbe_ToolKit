export type CounterSession = { sessionId: string; value: number };
export type Operation = 'counter.open' | 'counter.increment' | 'counter.close' | 'pallet.prepare' | 'pallet.preview' | 'pallet.alignment';
export interface ToolkitAPI {
  freight(action: 'status' | 'choose' | 'create' | 'reupload' | 'open' | 'setTailscale', data?: { company?: string; date?: string; id?: string; enabled?: boolean }): Promise<FreightState>;
  palletvision(action: 'status' | 'choose' | 'open' | 'setTailscale' | 'update' | 'import' | 'selectVideo', data?: { id?: string; enabled?: boolean; videoPath?: string; heightInches?: number; widthInches?: number; lengthInches?: number; notes?: string; referenceId?: string; updates?: { heightInches?: number; widthInches?: number; lengthInches?: number; device?: string; notes?: string; annotationsReviewed?: boolean } }): Promise<PalletVisionState & { videoPath?: string | null }>;
  connectPwa(action: 'status' | 'setTailscale' | 'setManualAddress', data?: { enabled?: boolean; address?: string }): Promise<ConnectPwaState>;
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

export type FreightState = { root: string; running: boolean; error: string; addresses: string[]; useTailscale: boolean; tailscale: { available: boolean; address?: string; hostname?: string; error?: string }; masterUrl: string; masterQr: string; shipments: { id: string; company: string; date: string; folder: string; closed: boolean; reupload: boolean; pictures: number; lastUploadSubfolder?: string; url: string; qr: string }[] };

export type PalletVisionEvent =
  | { type: 'upload_canceled'; captureId?: string; at: string }
  | { type: 'upload_lock_released'; reason: 'stale_timeout' | 'stale_no_progress' | 'forced'; at: string; detail?: string }
  | { type: 'process_error'; message: string; at: string };
export type PalletVisionUploadLock = { reason: 'mobile_upload' | 'desktop_import'; startedAt: string; lastActivityAt: string; captureId?: string };
export type PalletVisionState = { root: string; running: boolean; error: string; addresses: string[]; useTailscale: boolean; tailscale: { available: boolean; address?: string; hostname?: string; error?: string }; qrUrl: string; qr: string; uploadBusy: boolean; uploadLock: PalletVisionUploadLock | null; events: PalletVisionEvent[]; pallets: { id: string; captureId: string; heightInches: number; widthInches: number; lengthInches: number; notes?: string; referenceId?: string; capturedAt: string; deviceToken: string; folder: string; processingStatus: string; framesExtracted: number }[] };

export type ConnectPwaDevice = { id: string; userAgent: string; ip: string; lastSeen: string };
export type ConnectPwaState = {
  running: boolean;
  port: number;
  httpsPort?: number;
  error: string;
  addresses: string[];
  useTailscale: boolean;
  tailscale: { available: boolean; address?: string; hostname?: string; error?: string };
  qrUrl: string;
  httpsUrl?: string;
  qr: string;
  devices: ConnectPwaDevice[];
  reachability: { freight: boolean; palletvision: boolean };
  manualAddress?: string;
};
