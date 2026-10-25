export type Picker = {
  id: string;
  name: string;
  intervalDays: number;
  lastWatered: string;
  wateringLog?: string[];
};

export type PickerWaterNotification = {
  id: string;
  pickerId: string;
  pickerName: string;
  title: string;
  body: string;
  severity: 'due' | 'overdue';
};

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDays(key: string, days: number) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return todayKey(date);
}

export function dueDate(picker: Picker) {
  return addDays(picker.lastWatered, picker.intervalDays);
}

export function pickerStatus(picker: Picker, today = todayKey()) {
  const due = dueDate(picker);
  if (due < today) return 'overdue' as const;
  if (due === today) return 'due' as const;
  return 'upcoming' as const;
}

export function duePickers(pickers: Picker[], today = todayKey()) {
  return pickers.filter(picker => dueDate(picker) <= today);
}

export function appendWateringLog(log: string[] | undefined, iso: string) {
  return [iso, ...(log ?? [])].slice(0, 3);
}

export function markPickerWatered(picker: Picker, at = new Date()) {
  return {
    ...picker,
    lastWatered: todayKey(at),
    wateringLog: appendWateringLog(picker.wateringLog, at.toISOString())
  };
}

export function parsePickers(raw: unknown): Picker[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Picker =>
    typeof item?.id === 'string' &&
    typeof item.name === 'string' &&
    item.name.trim().length > 0 &&
    Number.isInteger(item.intervalDays) && item.intervalDays > 0 &&
    typeof item.lastWatered === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.lastWatered) &&
    (item.wateringLog === undefined || (Array.isArray(item.wateringLog) && item.wateringLog.every((e: unknown) => typeof e === 'string')))
  ).map(item => ({
    ...item,
    name: item.name.trim(),
    wateringLog: item.wateringLog?.slice(0, 3)
  }));
}

export function buildPickerWaterNotifications(pickers: Picker[], today = todayKey()) {
  const items: PickerWaterNotification[] = [];
  for (const picker of pickers) {
    const status = pickerStatus(picker, today);
    if (status === 'upcoming') continue;
    const due = dueDate(picker);
    items.push({
      id: `picker-water-${picker.id}`,
      pickerId: picker.id,
      pickerName: picker.name,
      title: status === 'overdue' ? 'Watering overdue' : 'Watering due today',
      body: `${picker.name} · due ${due}`,
      severity: status
    });
  }
  items.sort((a, b) => (a.severity === b.severity ? a.pickerName.localeCompare(b.pickerName) : a.severity === 'overdue' ? -1 : 1));
  return { count: items.length, items };
}
