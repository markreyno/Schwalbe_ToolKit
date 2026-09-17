import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ChevronLeft, ChevronRight, Forklift, Plus, Trash2 } from 'lucide-react';
import { dueDate, duePickers, readPickers, savePickers, todayKey, usePickers, useToday, type Picker } from './store';

function dateLabel(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function status(picker: Picker, today: string) {
  const due = dueDate(picker);
  return due < today ? 'overdue' : due === today ? 'due' : 'upcoming';
}

export function PickerWaterPage() {
  const pickers = usePickers();
  const [removing, setRemoving] = useState<Picker | null>(null);
  const [removeError, setRemoveError] = useState('');
  const removeDialog = useRef<HTMLDialogElement>(null);
  const cancelRemove = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (removing) {
      removeDialog.current?.showModal();
      cancelRemove.current?.focus();
    } else {
      removeDialog.current?.close();
    }
  }, [removing]);
  function confirmRemove() {
    if (!removing) return;
    try {
      savePickers(readPickers().filter(item => item.id !== removing.id));
      setRemoving(null);
    } catch { setRemoveError('Could not remove this picker. Please try again.'); }
  }
  const today = useToday();
  const [name, setName] = useState('');
  const [interval, setInterval] = useState(14);
  const [lastWatered, setLastWatered] = useState(today);
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editInterval, setEditInterval] = useState(14);
  const due = duePickers(pickers, today);

  function addPicker(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !Number.isInteger(interval) || interval < 1 || !lastWatered) return;
    savePickers([...readPickers(), { id: crypto.randomUUID(), name: name.trim(), intervalDays: interval, lastWatered }]);
    setName(''); setInterval(14); setLastWatered(todayKey());
  }
  function updatePicker(picker: Picker) {
    if (!editName.trim() || !Number.isInteger(editInterval) || editInterval < 1) return;
    savePickers(readPickers().map(item => item.id === picker.id ? { ...item, name: editName.trim(), intervalDays: editInterval } : item));
    setEditing(null);
  }
  function shiftMonth(delta: number) {
    const date = new Date(year, month + delta, 1);
    setYear(date.getFullYear()); setMonth(date.getMonth());
  }
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return <>
    <dialog ref={removeDialog} className="picker-remove-dialog" aria-labelledby="remove-picker-title" aria-describedby="remove-picker-description" onCancel={() => setRemoving(null)}>
      <div className="tool-icon"><Trash2 size={24}/></div>
      <p className="eyebrow">PICKER WATER SCHEDULER</p>
      <h2 id="remove-picker-title">Remove picker?</h2>
      <p id="remove-picker-description">Remove <strong>{removing?.name}</strong> and its watering schedule? This cannot be undone.</p>
      {removeError && <p className="error-panel" role="alert">{removeError}</p>}
      <div className="picker-remove-actions">
        <button ref={cancelRemove} type="button" className="picker-remove-cancel" onClick={() => setRemoving(null)}>Keep picker</button>
        <button type="button" className="picker-remove-confirm" onClick={confirmRemove}><Trash2 size={16}/> Remove picker</button>
      </div>
    </dialog>
    <Link to="/" className="back-link"><ArrowLeft size={16}/> Back to tool hub</Link>
    <header className="page-heading"><div><p className="eyebrow">SHIPPING & WAREHOUSE</p><h1>Picker Water Scheduler</h1><p className="subtitle">Track watering for every picker and see what is due next.</p></div></header>

    {due.length > 0 && <div className="water-alert" role="status"><Forklift size={20}/><div><strong>{due.length} picker{due.length === 1 ? '' : 's'} need{due.length === 1 ? 's' : ''} water</strong><p>{due.map(picker => picker.name).join(', ')}</p></div></div>}
    <div className="water-layout"><div className="water-stack">
      <section className="water-panel"><h2>Add a picker</h2><form onSubmit={addPicker} className="water-form"><label>Picker name<input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Picker 1" maxLength={80} required/></label><div className="water-form-row"><label>Water every (days)<input type="number" min="1" max="3650" value={interval} onChange={event => setInterval(Number(event.target.value))} required/></label><label>Last watered<input type="date" value={lastWatered} onChange={event => setLastWatered(event.target.value)} required/></label></div><button className="water-primary" type="submit"><Plus size={17}/> Add picker</button></form></section>
      <section className="water-panel"><div className="water-panel-heading"><h2>Pickers</h2><span>{pickers.length} total</span></div>{pickers.length === 0 ? <p className="water-empty">Add a picker to start its watering schedule.</p> : <div className="water-list">{[...pickers].sort((a,b) => dueDate(a).localeCompare(dueDate(b))).map(picker => <div className="water-picker" key={picker.id}><div className="water-picker-main"><span className={`water-dot ${status(picker, today)}`}/><div><strong>{picker.name}</strong><p>Next: {dateLabel(dueDate(picker))} Â· Every {picker.intervalDays} day{picker.intervalDays === 1 ? '' : 's'}</p></div><span className={`water-status ${status(picker, today)}`}>{status(picker, today)}</span></div>{editing === picker.id ? <form className="water-edit" onSubmit={event => { event.preventDefault(); updatePicker(picker); }}><label>Name<input value={editName} onChange={event => setEditName(event.target.value)} maxLength={80} required/></label><label>Interval (days)<input type="number" min="1" max="3650" value={editInterval} onChange={event => setEditInterval(Number(event.target.value))} required/></label><button type="submit">Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></form> : <div className="water-actions"><button onClick={() => savePickers(readPickers().map(item => item.id === picker.id ? { ...item, lastWatered: todayKey() } : item))}><Forklift size={14}/> Mark watered</button><button onClick={() => { setEditing(picker.id); setEditName(picker.name); setEditInterval(picker.intervalDays); }}>Edit</button><button className="water-delete" aria-label={`Remove ${picker.name}`} onClick={() => { setRemoveError(''); setRemoving(picker); }}><Trash2 size={14}/></button></div>}</div>)}</div>}</section>
    </div><section className="water-panel water-calendar"><div className="water-calendar-header"><div><h2>Watering calendar</h2><p>Next scheduled watering date for each picker</p></div><div className="water-month-controls"><button aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={17}/></button><strong>{monthLabel}</strong><button aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={17}/></button></div></div><div className="water-weekdays">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => <span key={day}>{day}</span>)}</div><div className="water-calendar-grid">{cells.map((day, index) => { const key = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : ''; const events = pickers.filter(picker => dueDate(picker) === key); return <div className={`water-day ${key === today ? 'today' : ''}`} key={index}>{day && <><span className="water-day-number">{day}</span>{events.map(picker => <span title={`${picker.name} Â· ${status(picker, today)}`} className={`water-event ${status(picker, today)}`} key={picker.id}>{picker.name}</span>)}</>}</div>; })}</div><div className="water-legend"><span><i className="overdue"/> Overdue</span><span><i className="due"/> Due today</span><span><i className="upcoming"/> Upcoming</span></div>{due.length > 0 && <p className="water-calendar-note">Overdue pickers remain in the list above until marked watered. The calendar shows each pickerâ€™s scheduled date.</p>}</section></div>
  </>;
}
