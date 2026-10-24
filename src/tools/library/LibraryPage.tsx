import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, BookOpen, Search } from 'lucide-react';
import { getLibraryMarkdown, libraryEntries } from './libraryManifest';
import { MarkdownBody } from './renderMarkdown';

export function LibraryPage() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(libraryEntries[0]?.id ?? 'library');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return libraryEntries;
    return libraryEntries.filter(entry => `${entry.title} ${entry.category} ${entry.keywords.join(' ')}`.toLowerCase().includes(q));
  }, [search]);
  const body = getLibraryMarkdown(selected).replace(/^#\s+.+\n+/, '');
  const active = libraryEntries.find(e => e.id === selected);

  return <>
    <Link to="/" className="back-link"><ArrowLeft size={16}/> All tools</Link>
    <header className="page-heading">
      <div>
        <p className="eyebrow">DOCUMENTATION</p>
        <h1>Library</h1>
        <p className="subtitle">Searchable guides for every tool. Works offline once the app is open.</p>
      </div>
      <BookOpen size={34}/>
    </header>
    <div className="library-layout">
      <aside className="library-sidebar">
        <label className="search library-search">
          <Search size={17}/>
          <input aria-label="Search library guides" placeholder="Search guides…" value={search} onChange={e => setSearch(e.target.value)}/>
        </label>
        <nav aria-label="Tool guides">
          <ul className="library-nav">
            {filtered.map(entry => (
              <li key={entry.id}>
                <button type="button" className={entry.id === selected ? 'selected' : ''} onClick={() => setSelected(entry.id)}>
                  <strong>{entry.title}</strong>
                  <span>{entry.category}</span>
                </button>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && <p className="library-empty">No guides match your search.</p>}
        </nav>
      </aside>
      <section className="library-content" aria-labelledby="library-doc-title">
        <h2 id="library-doc-title" className="library-doc-title">{active?.title ?? 'Guide'}</h2>
        <MarkdownBody source={body}/>
      </section>
    </div>
  </>;
}
