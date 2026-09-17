import { Link } from '@tanstack/react-router';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import type { Tool } from '../app/toolRegistry';
import { duePickers, usePickers, useToday } from '../tools/pickerWater/store';
export function ToolCard({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  const dueCount = duePickers(usePickers(), useToday()).length;
  return <article className={`tool-card ${tool.available ? 'available' : 'upcoming'}`}>
    <div className="card-top"><div className="tool-icon"><Icon size={30} strokeWidth={1.7}/></div><span className={`badge ${tool.available ? 'green' : ''}`}>{tool.id === 'picker-water' && dueCount > 0 ? `${dueCount} due` : tool.available ? 'Available' : 'Coming later'}</span></div>
    <p className="eyebrow card-category">{tool.category}</p><h3>{tool.name}</h3><p className="card-description">{tool.description}</p>
    <div className="card-bottom">{tool.available && tool.route ? <Link to={tool.route}>Open tool <ArrowUpRight size={18}/></Link> : <span>Planned tool <ArrowRight size={17}/></span>}</div>
  </article>;
}
