/**
 * Live feed — every event-bus signal as it arrives. Newly-mounted rows
 * spring in with a Rough.js underline drawing left-to-right, the
 * signature animation of the studio.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSignals } from '../lib/ws';
import { Panel } from '../components/Panel';
import { Tag } from '../components/Tag';
import { EmptyState } from '../components/EmptyState';
import { RoughUnderline } from '../lib/rough';
import { StatusPill } from '../components/StatusPill';

const SIGNAL_TONES: Record<string, 'live' | 'success' | 'failure' | 'pending' | 'info'> = {
  PRICE_DIP: 'failure',
  PRICE_SPIKE: 'success',
  THRESHOLD_HIT: 'pending',
  DRIFT_DETECTED: 'pending',
  ALLOCATION_SHIFT: 'info',
  DCA_TICK: 'info',
  WHALE_BUY: 'success',
  WHALE_SELL: 'failure',
  PROPOSAL: 'live',
  VOTE_CAST: 'info',
  CONSENSUS: 'live',
};

export default function LiveFeedPage() {
  const signals = useSignals();
  const [filter, setFilter] = useState<string | null>(null);

  const types = useMemo(() => {
    const set = new Set<string>();
    for (const s of signals) set.add(s.type);
    return Array.from(set).sort();
  }, [signals]);

  const visible = useMemo(() => {
    const arr = filter ? signals.filter((s) => s.type === filter) : signals;
    // Newest first, capped to 80 for paint cost.
    return [...arr].slice(-80).reverse();
  }, [signals, filter]);

  return (
    <div className="space-y-6">
      <Panel title="live feed" sideNote="↓ newest at the top, drawn as they land">
        <div className="flex flex-wrap gap-2 mb-5">
          <Tag active={filter === null} onClick={() => setFilter(null)}>all</Tag>
          {types.map((t) => (
            <Tag key={t} active={filter === t} onClick={() => setFilter(t)}>
              {t.toLowerCase().replace(/_/g, ' ')}
            </Tag>
          ))}
        </div>

        {visible.length === 0 ? (
          <EmptyState>no signals yet — aegis's still asleep</EmptyState>
        ) : (
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {visible.map((s, idx) => (
                <motion.li
                  key={`${s.type}-${s.timestamp}-${idx}`}
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                  className="flex items-start gap-4"
                >
                  <div className="pt-1 shrink-0">
                    <StatusPill tone={SIGNAL_TONES[s.type] ?? 'info'}>
                      {s.type.toLowerCase().replace(/_/g, ' ')}
                    </StatusPill>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-ink text-sm break-all">
                      <SignalDetail signal={s} />
                    </div>
                    <div className="text-graphite text-xs mt-1 num">
                      {fmtTime(s.timestamp)}
                    </div>
                    {idx === 0 && <RoughUnderline width={120} />}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Panel>
    </div>
  );
}

function SignalDetail({ signal }: { signal: any }) {
  // Render the most informative fields without flooding the row.
  const interesting = ['token', 'chain', 'amount', 'fromToken', 'toToken', 'price', 'change', 'address'];
  const parts = interesting
    .filter((k) => signal[k] !== undefined && signal[k] !== null)
    .map((k) => `${k}: ${typeof signal[k] === 'object' ? JSON.stringify(signal[k]) : signal[k]}`);
  if (parts.length === 0) {
    // Fallback — show a few non-meta keys.
    const fallback = Object.entries(signal)
      .filter(([k]) => k !== 'type' && k !== 'timestamp')
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    return <span>{fallback.join(' · ') || '(no detail)'}</span>;
  }
  return <span>{parts.join(' · ')}</span>;
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}
