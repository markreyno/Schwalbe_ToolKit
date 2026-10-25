import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

function readStored(storageKey: string, defaultOpen: boolean) {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === '1') return true;
    if (value === '0') return false;
  } catch { /* private mode */ }
  return defaultOpen;
}

type CollapsibleSectionProps = {
  storageKey: string;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

export function CollapsibleSection({ storageKey, title, defaultOpen = false, children, className }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(() => readStored(storageKey, defaultOpen));
  const panelId = useId();

  useEffect(() => {
    try { localStorage.setItem(storageKey, open ? '1' : '0'); } catch { /* ignore */ }
  }, [open, storageKey]);

  return (
    <section className={['freight-panel', 'collapsible-section', className].filter(Boolean).join(' ')}>
      <h2 className="collapsible-section__heading">
        <button
          type="button"
          className="collapsible-section__trigger"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(value => !value)}
        >
          <span>{title}</span>
          <ChevronDown size={18} className={`collapsible-section__chevron${open ? ' is-open' : ''}`} aria-hidden />
        </button>
      </h2>
      <div id={panelId} className="collapsible-section__content" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
