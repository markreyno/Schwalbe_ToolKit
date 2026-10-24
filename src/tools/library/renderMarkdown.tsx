import type { ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) nodes.push(<strong key={`${match.index}-b`}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) nodes.push(<code key={`${match.index}-c`}>{token.slice(1, -1)}</code>);
    else {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (m) nodes.push(<a key={`${match.index}-a`} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function MarkdownBody({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      i++;
      blocks.push(<pre key={`pre-${i}`}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    if (line.startsWith('### ')) { blocks.push(<h3 key={`h3-${i}`}>{inline(line.slice(4))}</h3>); i++; continue; }
    if (line.startsWith('## ')) { blocks.push(<h2 key={`h2-${i}`}>{inline(line.slice(3))}</h2>); i++; continue; }
    if (line.startsWith('# ')) { blocks.push(<h1 key={`h1-${i}`}>{inline(line.slice(2))}</h1>); i++; continue; }
    if (/^[-*] /.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) { items.push(<li key={`li-${i}`}>{inline(lines[i].slice(2))}</li>); i++; }
      blocks.push(<ul key={`ul-${i}`}>{items}</ul>);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(<li key={`oli-${i}`}>{inline(lines[i].replace(/^\d+\.\s*/, ''))}</li>); i++; }
      blocks.push(<ol key={`ol-${i}`}>{items}</ol>);
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#') && !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i]) && !lines[i].startsWith('```')) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={`p-${i}`}>{inline(para.join(' '))}</p>);
  }
  return <article className="library-article">{blocks}</article>;
}
