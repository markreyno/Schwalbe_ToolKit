import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Shuffle, Plus, Trash2, Trophy } from 'lucide-react';

const storageKey = 'schwalbe-toolkit.uline-raffle.names.v1';
function readNames(): { names: string[]; error: string } {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(saved) || !saved.every(name => typeof name === 'string' && name.trim())) throw new Error();
    return { names: saved, error: '' };
  } catch { return { names: [], error: 'Saved names could not be loaded. Adding a name will start a new saved list.' }; }
}

export function RafflePage() {
  const [initial] = useState(readNames);
  const [names, setNames] = useState(initial.names);
  const [name, setName] = useState('');
  const [error, setError] = useState(initial.error);
  const [winner, setWinner] = useState<string | null>(null);
  const [draw, setDraw] = useState(0);
  function save(next: string[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setNames(next); setWinner(null); setError('');
      return true;
    } catch { setError('Names could not be saved. Please try again. Your list has not changed.'); return false; }
  }
  function raffle() {
    if (!names.length) return;
    setWinner(names[Math.floor(Math.random() * names.length)]);
    setDraw(value => value + 1);
  }
  return <>
    <Link className="back-link" to="/"><ArrowLeft size={17}/> All tools</Link>
    <header className="counter-heading"><div className="tool-icon"><Shuffle size={29}/></div><div><p className="eyebrow">EVERYDAY ESSENTIALS</p><h1>Uline Raffle</h1></div><span className="badge green">Saved locally</span></header>
    <p className="subtitle">Add your names, then pick a winner at random.</p>
    <div className="pallet-grid raffle-tool">
      <section className="pallet-panel" aria-labelledby="names-heading">
        <p className="eyebrow">THE LINEUP</p><h2 id="names-heading">Names <span className="count-badge">{names.length}</span></h2>
        <form onSubmit={event => { event.preventDefault(); if (name.trim() && save([...names, name.trim()])) setName(''); }}>
          <label htmlFor="raffle-name">Name</label><input id="raffle-name" value={name} onChange={event => setName(event.target.value)} placeholder="Enter a name" maxLength={120}/>
          <button className="increment-button" disabled={!name.trim()}><Plus size={20}/> Add name</button>
        </form>
        {error && <div className="error-panel" role="alert">{error}</div>}
        {names.length ? <ul className="raffle-names" aria-label="Raffle names">{names.map((entry, index) => <li key={index}><span>{entry}</span><button type="button" aria-label={`Remove ${entry}`} onClick={() => save(names.filter((_, position) => position !== index))}><Trash2 size={17}/></button></li>)}</ul> : <div className="empty-state"><h3>No names yet</h3><p>Add a name to get started.</p></div>}
        <p className="pallet-stock">Names stay saved when you leave or reopen the app. Each entry gets one chance per draw.</p>
      </section>
      <section className="pallet-panel raffle-result" aria-labelledby="winner-heading">
        <div className="tool-icon"><Trophy size={29}/></div><h2 id="winner-heading">Your winner</h2>
        <div role="status" aria-live="polite" aria-atomic="true">{winner !== null ? <><p className="raffle-winner">{winner}</p><p className="counter-hint">Winner of draw {draw}</p></> : <p className="counter-hint">{names.length ? 'Ready when you are. Pick a name below.' : 'Add at least one name to run the raffle.'}</p>}</div>
        <button type="button" className="increment-button" onClick={raffle} disabled={!names.length}><Shuffle size={22}/> Raffle</button>
        <p className="pallet-stock">Winners stay in the list for the next draw. Remove a name to exclude it.</p>
      </section>
    </div>
  </>;
}
