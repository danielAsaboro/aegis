/**
 * Logs — live tail of every pino log line. Filter chips per child-logger
 * `component` field and per level. Pauses auto-scroll when the user
 * scrolls up to read.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLogs } from '../lib/ws';
import { Panel } from '../components/Panel';
import { Tag } from '../components/Tag';
import { EmptyState } from '../components/EmptyState';

type Parsed = {
  raw: string;
  ts: string;
  level: number;
  component?: string;
  msg?: string;
};

const LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

const LEVEL_COLORS: Record<number, string> = {
  10: 'text-graphite',
  20: 'text-graphite',
  30: 'text-ink',
  40: 'text-peach',
  50: 'text-blush',
  60: 'text-blush',
};

function parseLine(raw: string): Parsed {
  try {
    const j = JSON.parse(raw);
    return { raw, ts: j.time || '', level: j.level ?? 30, component: j.component, msg: j.msg };
  } catch {
    return { raw, ts: '', level: 30, msg: raw };
  }
}

export default function LogsPage() {
  const lines = useLogs();
  const [components, setComponents] = useState<Set<string>>(new Set());
  const [levelFilter, setLevelFilter] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const parsed = useMemo(() => lines.map(parseLine), [lines]);
  const allComponents = useMemo(() => {
    const set = new Set<string>();
    for (const p of parsed) if (p.component) set.add(p.component);
    return Array.from(set).sort();
  }, [parsed]);

  const filtered = useMemo(() => {
    return parsed.filter((p) => {
      if (levelFilter !== null && p.level < levelFilter) return false;
      if (components.size > 0 && (!p.component || !components.has(p.component))) return false;
      return true;
    });
  }, [parsed, components, levelFilter]);

  // Auto-scroll to bottom when new lines arrive (unless user scrolled up).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !autoScroll) return;
    el.scrollTop = el.scrollHeight;
  }, [filtered, autoScroll]);

  function toggleComponent(c: string) {
    setComponents((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  return (
    <Panel
      title="logs"
      sideNote={autoScroll ? '↓ live tail' : '↑ paused (scroll down to resume)'}
    >
      <div className="flex flex-wrap gap-2 mb-4">
        <Tag active={levelFilter === null} onClick={() => setLevelFilter(null)}>all levels</Tag>
        {[30, 40, 50].map((lvl) => (
          <Tag key={lvl} active={levelFilter === lvl} onClick={() => setLevelFilter(lvl)}>
            {LEVEL_NAMES[lvl]}+
          </Tag>
        ))}
        <span className="mx-2 text-graphite font-hand">·</span>
        {allComponents.map((c) => (
          <Tag key={c} active={components.has(c)} onClick={() => toggleComponent(c)}>
            {c}
          </Tag>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>nothing logged yet</EmptyState>
      ) : (
        <div
          ref={containerRef}
          onScroll={onScroll}
          className="font-mono text-xs leading-relaxed max-h-[520px] overflow-y-auto bg-paper-edge/50 p-4 rounded-md"
        >
          {filtered.map((p, i) => (
            <div key={i} className={`whitespace-pre-wrap ${LEVEL_COLORS[p.level] ?? 'text-ink'}`}>
              <span className="num text-graphite mr-2">{(p.ts || '').slice(11, 23)}</span>
              <span className="font-display mr-2">{(LEVEL_NAMES[p.level] ?? '').padEnd(5)}</span>
              {p.component && <span className="text-graphite mr-2">[{p.component}]</span>}
              <span>{p.msg || p.raw}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
