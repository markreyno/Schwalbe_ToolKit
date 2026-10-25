import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  addDays,
  dueDate,
  duePickers,
  parsePickers,
  todayKey,
  type Picker
} from '../../../shared/pickerWater';

export type { Picker } from '../../../shared/pickerWater';
export { addDays, dueDate, duePickers, todayKey };

const KEY = 'schwalbe-picker-water-v1';
const EVENT = 'picker-water-changed';
let cache: Picker[] | null = null;

function syncToDesktop(pickers: Picker[]) {
  if (typeof window === 'undefined' || !window.toolkit?.pickerWater) return;
  void window.toolkit.pickerWater('sync', { pickers }).catch(() => {});
}

export function readPickers(): Picker[] {
  if (cache) return cache;
  try {
    cache = parsePickers(JSON.parse(localStorage.getItem(KEY) || '[]'));
  } catch { cache = []; }
  return cache;
}

export function savePickers(pickers: Picker[]) {
  localStorage.setItem(KEY, JSON.stringify(pickers));
  cache = pickers;
  window.dispatchEvent(new Event(EVENT));
  syncToDesktop(pickers);
}

export function usePickers() {
  return useSyncExternalStore(callback => {
    const onStorage = (event: StorageEvent) => { if (event.key === KEY) { cache = null; callback(); } };
    window.addEventListener(EVENT, callback);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', onStorage); };
  }, readPickers);
}

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

if (typeof window !== 'undefined') {
  queueMicrotask(() => syncToDesktop(readPickers()));
}
