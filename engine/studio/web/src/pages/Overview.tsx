import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { jsonGet } from '../lib/api';
import { StickyNote } from '../components/StickyNote';
import { Panel } from '../components/Panel';
import { Squiggle } from '../lib/rough';
import { EmptyState } from '../components/EmptyState';
import { StatusPill } from '../components/StatusPill';

type Overview = {
  engine: { bootAt: string; uptimeMs: number; nodeVersion: string; pid: number };
  strategies: { id: string; name: string; signals: string[] }[];
  signals: Record<string, number>;
  recentSignals: { type: string; timestamp: string }[];
  counts: {
    activeDcaPlans: number;
    activeRebalanceTargets: number;
    activePriceAlerts: number;
    tradesToday: number;
    invocationsToday: number;
  };
  latestTrade: { fromToken: string; toToken: string; success: boolean; createdAt: string } | null;
};

function fmtUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function OverviewPage() {
  const { data } = useQuery({
    queryKey: ['overview'],
    queryFn: () => jsonGet<Overview>('/api/overview'),
    refetchInterval: 5000,
  });

  if (!data) {
    return <EmptyState>warming up… (or the engine isn't running yet?)</EmptyState>;
  }

  const totalSignals = Object.values(data.signals).reduce((a, b) => a + b, 0);

  const stickies = [
    { label: 'engine uptime', value: fmtUptime(data.engine.uptimeMs), hint: `pid ${data.engine.pid}`, rotate: -1.2, fill: 'var(--butter)' },
    { label: 'signals total', value: totalSignals, hint: `${Object.keys(data.signals).filter((k) => data.signals[k] > 0).length} types active`, rotate: 0.8, fill: 'var(--mint)' },
    { label: 'trades today', value: data.counts.tradesToday, hint: data.latestTrade ? `last: ${data.latestTrade.fromToken} → ${data.latestTrade.toToken}` : 'nothing yet', rotate: -0.5, fill: 'var(--peach)' },
    { label: 'agent runs', value: data.counts.invocationsToday, hint: 'today', rotate: 1.4, fill: 'var(--sky)' },
  ];

  return (
    <div className="space-y-10">
      <section>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {stickies.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, scale: 0.96, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ delay: i * 0.06, type: 'spring', stiffness: 220, damping: 18 }}
            >
              <StickyNote {...s} />
            </motion.div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Panel title="active strategies" sideNote="← the ones running right now">
          {data.strategies.length === 0 ? (
            <EmptyState>no strategies attached yet</EmptyState>
          ) : (
            <ul className="space-y-3">
              {data.strategies.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-display text-lg text-ink">{s.name}</div>
                    <div className="text-graphite text-sm">listens to {s.signals.join(', ').toLowerCase()}</div>
                  </div>
                  <StatusPill tone="live">live</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="signal counters" sideNote="↑ since boot">
          {totalSignals === 0 ? (
            <EmptyState>no signals yet — aegis's still asleep</EmptyState>
          ) : (
            <ul className="space-y-2">
              {Object.entries(data.signals)
                .filter(([, v]) => v > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([k, v]) => (
                  <li key={k}>
                    <div className="flex items-baseline justify-between">
                      <span className="font-display text-base">{k.toLowerCase().replace(/_/g, ' ')}</span>
                      <span className="num font-display text-xl">{v}</span>
                    </div>
                    <Squiggle height={8} />
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      </section>

      <section>
        <Panel title="active plans + alerts">
          <div className="grid grid-cols-3 gap-6">
            <Counter label="DCA plans" value={data.counts.activeDcaPlans} />
            <Counter label="rebalance targets" value={data.counts.activeRebalanceTargets} />
            <Counter label="price alerts" value={data.counts.activePriceAlerts} />
          </div>
        </Panel>
      </section>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-hand text-graphite text-lg">{label}</div>
      <div className="font-display num text-4xl text-ink">{value}</div>
    </div>
  );
}
