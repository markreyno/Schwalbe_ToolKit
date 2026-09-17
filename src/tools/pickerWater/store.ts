import { useEffect, useState, useSyncExternalStore } from 'react';

export type Picker = { id: string; name: string; intervalDays: number; lastWatered: string };
const KEY = 'schwalbe-picker-water-v1';
const EVENT = 'picker-water-changed';
let cache: Picker[] | null = null;

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function addDays(key: string, days: number) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return todayKey(date);
}
export function dueDate(picker: Picker) { return addDays(picker.lastWatered, picker.intervalDays); }
export function readPickers(): Picker[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    cache = Array.isArray(parsed) ? parsed.filter((item): item is Picker =>
      typeof item?.id === 'string' && typeof item.name === 'string' &&
      Number.isInteger(item.intervalDays) && item.intervalDays > 0 &&
      typeof item.lastWatered === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.lastWatered)) : [];
  } catch { cache = []; }
  return cache;
}
export function savePickers(pickers: Picker[]) {
  localStorage.setItem(KEY, JSON.stringify(pickers));
  cache = pickers;
  window.dispatchEvent(new Event(EVENT));
}
export function usePickers() {
  return useSyncExternalStore(callback => {
    const onStorage = (event: StorageEvent) => { if (event.key === KEY) { cache = null; callback(); } };
    window.addEventListener(EVENT, callback);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', onStorage); };
  }, readPickers);
}
export function duePickers(pickers: Picker[], today = todayKey()) { return pickers.filter(picker => dueDate(picker) <= today); }
export function useToday() {
  const [today, setToday] = useState(todayKey);
  useEffect(() => {
    const refresh = () => setToday(todayKey());
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return today;
}
