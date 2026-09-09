import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Plus, RotateCcw, Tally5, AlertCircle } from 'lucide-react';
import type { CounterSession } from '../../../shared/protocol';

export function CounterPage() {
  const [generation, setGeneration] = useState(0);
  const [session, setSession] = useState<CounterSession | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const active = useRef<{ alive: boolean; failed: boolean; sessionId?: string; queue: Promise<void> } | null>(null);
  const increment = useMutation({ mutationFn: (sessionId: string) => window.toolkit.incrementCounter(sessionId), retry: false, gcTime: 0 });
  useEffect(() => {
    const run = { alive: true, failed: false, sessionId: undefined as string | undefined, queue: Promise.resolve() };
    active.current = run;
    setSession(null); setError(''); setPending(0);
    const fail = () => { if (run.alive) { run.failed = true; setPending(0); setError('The counter connection was interrupted. Start a fresh counter to continue.'); } };
    if (!window.toolkit) { fail(); return () => { run.alive = false; }; }
    const unsubscribe = window.toolkit.onBackendFailure(fail);
    void window.toolkit.openCounter().then(result => {
      run.sessionId = result.sessionId;
      if (!run.alive || run.failed) void window.toolkit.closeCounter(result.sessionId).catch(() => {});
      else setSession(result);
    }).catch(fail);
    return () => {
      run.alive = false;
      unsubscribe();
      if (run.sessionId) void run.queue.then(() => window.toolkit.closeCounter(run.sessionId!)).catch(() => {});
    };
  }, [generation]);
  function add() {
    const run = active.current;
    if (!run?.alive || run.failed || !run.sessionId) return;
    setPending(value => value + 1);
    run.queue = run.queue.then(async () => {
      if (!run.alive || run.failed) return;
      try {
        const result = await increment.mutateAsync(run.sessionId!);
        if (run.alive && !run.failed) setSession(result);
      } catch {
        run.failed = true;
        if (run.alive) { setError('We couldn’t confirm that count. Start a fresh counter to continue.'); setPending(0); }
      } finally { if (run.alive && !run.failed) setPending(value => value - 1); }
    });
  }
  return <>
    <Link className="back-link" to="/"><ArrowLeft size={17}/> All tools</Link>
    <header className="counter-heading"><div className="tool-icon"><Tally5 size={29}/></div><div><p className="eyebrow">EVERYDAY ESSENTIALS</p><h1>Counter</h1></div><span className="badge green">Fresh session</span></header>
    <p className="subtitle">One tap, one more. Keep track of what’s in front of you.</p>
    <section className="counter-panel" aria-label="Counter tool">
      <div className="counter-panel-top"><span className="eyebrow">CURRENT COUNT</span><span className="session-indicator"><span/>{error ? 'Disconnected' : session ? 'Ready to count' : 'Opening counter'}</span></div>
      <output className="counter-value" aria-label="Current count" aria-live="polite">{session ? session.value.toLocaleString('en-US') : '—'}</output>
      <p className="counter-hint">{error ? 'Your last confirmed count is shown above.' : session ? 'Every press adds one.' : 'Preparing a fresh counter…'}</p>
      <button className="increment-button" onClick={add} disabled={!session || !!error}><Plus size={25}/> Add one <span>+1</span></button>
      <p className="keyboard-hint">{pending > 0 ? `Counting ${pending} pending ${pending === 1 ? 'press' : 'presses'}…` : 'Click to count · Enter or Space when focused'}</p>
      {error && <div className="error-panel" role="alert"><AlertCircle size={20}/><div><p>{error}</p><button onClick={() => setGeneration(value => value + 1)}><RotateCcw size={16}/> Start fresh at 0</button></div></div>}
    </section>
    <div className="counter-note"><RotateCcw size={18}/><p><strong>A fresh start, every time.</strong> Your count resets to zero when you leave and reopen this tool.</p></div>
  </>;
}
