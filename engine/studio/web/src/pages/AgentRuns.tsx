import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { jsonGet } from '../lib/api';
import { Panel } from '../components/Panel';
import { EmptyState } from '../components/EmptyState';
import { StatusPill } from '../components/StatusPill';
import { Squiggle } from '../lib/rough';

type InvRow = {
  id: string;
  userId: string;
  source: string;
  model: string;
  status: string;
  totalTokens: number | null;
  steps: number | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  _count: { toolCalls: number };
};

type ToolCall = {
  id: string;
  toolName: string;
  success: boolean;
  durationMs: number | null;
  errorMsg: string | null;
  createdAt: string;
  input: string;
  output: string | null;
};

type InvDetail = InvRow & { toolCalls: ToolCall[] };

export default function AgentRunsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: list } = useQuery({
    queryKey: ['agent', 'invocations'],
    queryFn: () => jsonGet<{ rows: InvRow[]; nextCursor: string | null }>('/api/agent/invocations'),
    refetchInterval: 4000,
  });

  const { data: detail } = useQuery({
    queryKey: ['agent', 'invocation', selectedId],
    queryFn: () => jsonGet<InvDetail>(`/api/agent/invocations/${selectedId}`),
    enabled: !!selectedId,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2">
        <Panel title="agent runs" sideNote="newest first">
          {!list || list.rows.length === 0 ? (
            <EmptyState>the agent hasn't run yet</EmptyState>
          ) : (
            <ul className="space-y-2 max-h-[640px] overflow-y-auto pr-2">
              {list.rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left p-3 rounded-md transition-colors ${
                      selectedId === r.id ? 'bg-paper-edge' : 'hover:bg-paper-edge/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-display text-sm">{r.source}</span>
                      <StatusPill tone={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'failure' : 'pending'}>
                        {r.status}
                      </StatusPill>
                    </div>
                    <div className="flex items-center justify-between text-xs text-graphite mt-1 num">
                      <span>{r.model}</span>
                      <span>
                        {r._count.toolCalls} tools · {r.durationMs ? `${r.durationMs}ms` : '—'}
                      </span>
                    </div>
                    <div className="text-xs text-graphite num">{fmtDate(r.startedAt)}</div>
                  </button>
                  <Squiggle height={6} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="lg:col-span-3">
        <Panel title={detail ? `run · ${detail.id.slice(-8)}` : 'select a run'} sideNote={detail ? '↑ tool-call timeline' : ''}>
          {!detail ? (
            <EmptyState>pick a run on the left</EmptyState>
          ) : detail.toolCalls.length === 0 ? (
            <EmptyState>this run had no tool calls</EmptyState>
          ) : (
            <ol className="space-y-3 max-h-[640px] overflow-y-auto pr-2">
              {detail.toolCalls.map((c, i) => (
                <motion.li
                  key={c.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className="border-l-2 border-paper-edge pl-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-display text-base">{c.toolName}</span>
                    <StatusPill tone={c.success ? 'success' : 'failure'}>
                      {c.success ? 'ok' : 'fail'}
                    </StatusPill>
                    {c.durationMs !== null && (
                      <span className="text-graphite text-xs num">{c.durationMs}ms</span>
                    )}
                  </div>
                  {c.errorMsg && <div className="text-blush text-xs mt-1">{c.errorMsg}</div>}
                  <details className="mt-2">
                    <summary className="text-graphite text-xs cursor-pointer hover:text-ink">
                      input / output
                    </summary>
                    <pre className="text-xs bg-paper-edge/60 p-2 mt-1 rounded overflow-x-auto whitespace-pre-wrap">
                      {truncate(c.input, 800)}
                    </pre>
                    {c.output && (
                      <pre className="text-xs bg-paper-edge/60 p-2 mt-1 rounded overflow-x-auto whitespace-pre-wrap">
                        {truncate(c.output, 800)}
                      </pre>
                    )}
                  </details>
                </motion.li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}

function fmtDate(s: string) {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function truncate(s: string, n: number) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '… (truncated)' : s;
}
