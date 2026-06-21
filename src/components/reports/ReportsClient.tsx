'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Calendar, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Report {
  id: string;
  type: string;
  period: string;
  title: string;
  contentMd: string;
  createdAt: string;
}

interface ReportsResponse {
  success?: boolean;
  data?: Report[];
}

// ---------------------------------------------------------------------------
// Tiny markdown renderer — supports headings, bold, lists, code blocks.
// Pure client-side; no DOM-parsing danger (content is from our own DB).
// ---------------------------------------------------------------------------

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split(/\r?\n/);
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded border border-border bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground"
        >
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Headings
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = inline(h[2]);
      const cls =
        level === 1
          ? 'mt-3 mb-1 text-base font-bold text-foreground'
          : level === 2
            ? 'mt-2 mb-1 text-sm font-semibold text-foreground'
            : 'mt-2 mb-0.5 text-xs font-semibold text-foreground';
      out.push(
        <div key={key++} className={cls}>
          {text}
        </div>,
      );
      i++;
      continue;
    }

    // Unordered list item
    if (/^\s*[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*]\s+/, '');
        items.push(
          <li key={key++} className="ml-4 text-[11px] leading-relaxed text-muted-foreground">
            {inline(text)}
          </li>,
        );
        i++;
      }
      out.push(<ul key={key++} className="my-1 list-disc space-y-0.5">{items}</ul>);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s+/, '');
        items.push(
          <li key={key++} className="ml-4 text-[11px] leading-relaxed text-muted-foreground">
            {inline(text)}
          </li>,
        );
        i++;
      }
      out.push(<ol key={key++} className="my-1 list-decimal space-y-0.5">{items}</ol>);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      out.push(<div key={key++} className="h-1.5" />);
      i++;
      continue;
    }

    // Paragraph
    out.push(
      <p key={key++} className="text-[11px] leading-relaxed text-muted-foreground">
        {inline(line)}
      </p>,
    );
    i++;
  }

  return out;
}

function inline(text: string): React.ReactNode {
  // Bold **x** + inline code `x`
  const parts: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    if (m[2]) {
      parts.push(
        <strong key={key++} className="font-semibold text-foreground">
          {m[2]}
        </strong>,
      );
    } else if (m[3]) {
      parts.push(
        <code key={key++} className="rounded bg-muted/40 px-1 font-mono text-[10px] text-amber-300">
          {m[3]}
        </code>,
      );
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return `${Math.max(0, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function typeVariant(type: string): 'success' | 'info' | 'violet' | 'muted' {
  if (type === 'daily') return 'success';
  if (type === 'weekly') return 'info';
  if (type === 'monthly') return 'violet';
  return 'muted';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReportsClient(): React.ReactElement {
  const [filter, setFilter] = React.useState<'all' | 'daily' | 'weekly' | 'monthly'>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const q = useQuery<Report[]>({
    queryKey: ['reports', filter],
    queryFn: async () => {
      const url =
        filter === 'all' ? '/api/reports?limit=100' : `/api/reports?type=${filter}&limit=100`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('reports fetch failed');
      const json: ReportsResponse = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 300_000,
    staleTime: 240_000,
  });

  const reports = q.data ?? [];
  const selected = reports.find((r) => r.id === selectedId) ?? reports[0] ?? null;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <FileText className="h-5 w-5 text-primary" />
          Reports
        </h1>
        <p className="text-xs text-muted-foreground">
          Daily, weekly, and monthly intelligence reports generated by the Lazy Brain.
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5 w-fit">
        {(['all', 'daily', 'weekly', 'monthly'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded px-3 py-1 text-[11px] font-medium uppercase transition-colors',
              filter === f
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            Loading reports…
          </CardContent>
        </Card>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              No reports yet. Reports are generated by the scheduler — check back later.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {/* List */}
          <Card className="ring-1 ring-inset ring-border/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs">Report History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 p-3">
              {reports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors',
                    selected?.id === r.id
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-transparent hover:bg-muted/40',
                  )}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={typeVariant(r.type)} className="text-[9px] uppercase">
                        {r.type}
                      </Badge>
                      <span className="text-[11px] font-medium text-foreground">{r.period}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground line-clamp-1">
                      {r.title}
                    </span>
                    <span className="text-[9px] text-muted-foreground">{fmtAgo(r.createdAt)}</span>
                  </div>
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Selected report */}
          {selected ? (
            <Card className="ring-1 ring-inset ring-border/30">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={typeVariant(selected.type)} className="text-[10px] uppercase">
                        {selected.type}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">{selected.period}</span>
                    </div>
                    <CardTitle className="mt-1 text-base text-foreground">{selected.title}</CardTitle>
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {fmtDate(selected.createdAt)}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin">
                  {renderMarkdown(selected.contentMd)}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
