import { Tally5, Printer, Shuffle, Forklift, type LucideIcon } from 'lucide-react';
export type Tool = { id: string; name: string; description: string; icon: LucideIcon; route?: '/tools/counter' | '/tools/pallet' | '/tools/raffle' | '/tools/picker-water'; available: boolean; category: string };
export const tools: Tool[] = [
  { id: 'uline-raffle', name: 'Uline Raffle', description: 'Keep your list of names and pick a winner at random.', icon: Shuffle, route: '/tools/raffle', available: true, category: 'Everyday essentials' },
  { id: 'counter', name: 'Counter', description: 'Keep a tally with a single tap. A fresh start, every time.', icon: Tally5, route: '/tools/counter', available: true, category: 'Everyday essentials' },
  { id: 'pallet-label-printer', name: 'Pallet Label Printer', description: 'Create clear, consistent labels for your next shipment.', icon: Printer, route: '/tools/pallet', available: true, category: 'Shipping & warehouse' },
  { id: 'picker-water', name: 'Picker Water Scheduler', description: 'Keep picker watering dates visible and on schedule.', icon: Forklift, route: '/tools/picker-water', available: true, category: 'Shipping & warehouse' }
];
