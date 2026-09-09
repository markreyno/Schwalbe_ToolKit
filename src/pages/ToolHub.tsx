import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { tools } from '../app/toolRegistry';
import { ToolCard } from '../components/ToolCard';
import supersign from '../assets/schwalbe-supersign.png';
export function ToolHub() {
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault(); searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
  const filtered = tools.filter(tool => `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(search.toLowerCase().trim()));
  return <>
    <header className="page-heading"><div><p className="eyebrow">YOUR WORKDAY, SIMPLIFIED</p><h1>A place for every tool.</h1><p className="subtitle">Small tools. Less friction. More room to get things done.</p></div><span className="version">TOOLKIT / 01</span></header>
    <section className="welcome-banner"><div><span className="banner-tag"><span/> BUILT FOR THE EVERYDAY</span><h2>Good work starts<br/>with the right tools.</h2><p>Your everyday utilities, together in one workspace.</p></div><div className="banner-art" aria-hidden="true"><img src={supersign} alt=""/></div></section>
    <section className="tool-section" aria-labelledby="tools-heading"><div className="section-toolbar"><div className="section-title"><h2 id="tools-heading">Your tools</h2><span className="count-badge">{tools.filter(t => t.available).length} available</span></div><label className="search"><Search size={17}/><input ref={searchInput} aria-label="Search tools" placeholder="Find a tool…" value={search} onChange={event => setSearch(event.target.value)}/><kbd>/</kbd></label></div>
    <div className="tool-grid">{filtered.map(tool => <ToolCard key={tool.id} tool={tool}/>)}</div>{filtered.length === 0 && <div className="empty-state"><Search size={25}/><h3>No tools found</h3><p>Try a different name or function.</p><button className="text-button" onClick={() => setSearch('')}>Clear search</button></div>}</section>
    <div className="workspace-note"><span className="note-symbol">+</span><div><strong>A toolkit that grows with you.</strong><p>More tools will live here as your workflow evolves.</p></div></div>
  </>;
}
