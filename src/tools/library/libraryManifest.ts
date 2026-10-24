export type LibraryEntry = { id: string; title: string; category: string; keywords: string[] };

export const libraryEntries: LibraryEntry[] = [
  { id: 'library', title: 'Library', category: 'Help', keywords: ['documentation', 'search', 'offline', 'guides'] },
  { id: 'connect-pwa', title: 'Connect PWA', category: 'Phone access', keywords: ['qr', 'pwa', 'install', 'tailscale', 'https', '48734'] },
  { id: 'freight-pictures', title: 'Freight Pictures', category: 'Shipping & warehouse', keywords: ['photos', 'pallet', '48731', 'upload', 'batch'] },
  { id: 'palletvision-collector', title: 'PalletVision Data Collector', category: 'Data collection', keywords: ['video', 'training', '48732', 'ffmpeg'] },
  { id: 'pallet-label-printer', title: 'Pallet Label Printer', category: 'Shipping & warehouse', keywords: ['labels', 'printer', 'zebra'] },
  { id: 'picker-water', title: 'Picker Water Scheduler', category: 'Shipping & warehouse', keywords: ['water', 'forklift', 'schedule'] },
  { id: 'uline-raffle', title: 'Uline Raffle', category: 'Everyday essentials', keywords: ['raffle', 'names', 'winner'] },
  { id: 'counter', title: 'Counter', category: 'Everyday essentials', keywords: ['tally', 'count'] }
];

const rawDocs = import.meta.glob('../../../docs/library/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export function getLibraryMarkdown(id: string): string {
  const match = Object.entries(rawDocs).find(([path]) => path.endsWith(`/${id}.md`));
  return match?.[1] ?? '# Missing guide\n\nThis guide file is not bundled yet.';
}
