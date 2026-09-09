import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { UpdateState } from '../../shared/protocol';

export function AppUpdates() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let active = true;
    const unsubscribe = window.toolkit.onUpdateState(value => { if (active) setState(value); });
    void window.toolkit.updates('status').then(value => { if (active) setState(value); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);
  if (!state) return null;
  const labels = {
    disabled: 'Updates available in installed app', idle: 'Check for updates', checking: 'Checking…',
    available: `Download v${state.version}`, current: 'Up to date · Check again',
    downloading: `Downloading ${state.percent ?? 0}%`, ready: 'Restart to update', error: 'Retry update check'
  };
  const action = state.status === 'available' ? 'download' : state.status === 'ready' ? 'install' : 'check';
  return <div className="app-updates"><div className="sidebar-version">Schwalbe ToolKit <span>v{state.currentVersion}</span></div>
    <button className="update-button" disabled={['disabled', 'checking', 'downloading'].includes(state.status)} onClick={() => {
      void window.toolkit.updates(action).then(setState).catch(() => setState({ ...state, status: 'error', message: 'Unable to check for updates. Please try again.' }));
    }}>{state.status === 'available' ? <Download size={13}/> : <RefreshCw size={13}/>}<span>{labels[state.status]}</span></button>
    {state.status === 'error' && <p className="update-error" role="status">{state.message}</p>}
  </div>;
}
