import { Tally5, Printer, Shuffle, type LucideIcon } from 'lucide-react';
export type Tool = { id: string; name: string; description: string; icon: LucideIcon; route?: '/tools/counter' | '/tools/pallet' | '/tools/raffle'; available: boolean; category: string };
export const tools: Tool[] = [
  { id: 'uline-raffle', name: 'Uline Raffle', description: 'Keep your list of names and pick a winner at random.', icon: Shuffle, route: '/tools/raffle', available: true, category: 'Everyday essentials' },
  { id: 'counter', name: 'Counter', description: 'Keep a tally with a single tap. A fresh start, every time.', icon: Tally5, route: '/tools/counter', available: true, category: 'Everyday essentials' },
  { id: 'pallet-label-printer', name: 'Pallet Label Printer', description: 'Create clear, consistent labels for your next shipment.', icon: Printer, route: '/tools/pallet', available: true, category: 'Shipping & warehouse' }
];
