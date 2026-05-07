import { useQuery } from '@tanstack/react-query';
import { jsonGet } from '../lib/api';
import { Panel } from '../components/Panel';
import { EmptyState } from '../components/EmptyState';
import { StatusPill } from '../components/StatusPill';
import { Squiggle } from '../lib/rough';

type DCA = {
  id: string;
  fromToken: string;
  toToken: string;
  amount: string;
  chain: string;
  cron: string;
  status: string;
  totalExecuted: number;
  totalSpent: number;
  createdAt: string;
};
type Reb = {
  id: string;
  chain: string;
  threshold: number;
  status: string;
  createdAt: string;
  targets: { token: string; weight: number }[];
};
type Alert = {
  id: string;
  token: string;
  chain: string;
  type: string;
  direction: string;
  threshold: number;
  status: string;
  referencePrice: number | null;
  createdAt: string;
};

export default function StrategiesPage() {
  const dca = useQuery({ queryKey: ['strats', 'dca'], queryFn: () => jsonGet<DCA[]>('/api/strategies/dca'), refetchInterval: 6000 });
  const reb = useQuery({ queryKey: ['strats', 'reb'], queryFn: () => jsonGet<Reb[]>('/api/strategies/rebalance'), refetchInterval: 6000 });
  const alerts = useQuery({ queryKey: ['strats', 'alerts'], queryFn: () => jsonGet<Alert[]>('/api/strategies/alerts'), refetchInterval: 6000 });

  return (
    <div className="space-y-8">
      <Panel title="DCA plans" sideNote={`↓ ${dca.data?.length ?? 0} total`}>
        {!dca.data || dca.data.length === 0 ? (
          <EmptyState>no DCA plans yet</EmptyState>
        ) : (
          <ul className="space-y-3">
            {dca.data.map((p) => (
              <li key={p.id}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="font-display text-lg">
                      {p.amount} {p.fromToken} → {p.toToken}
                    </div>
                    <div className="text-graphite text-sm">
                      {p.chain} · cron <code className="bg-paper-edge px-1 rounded">{p.cron}</code>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-graphite text-xs">executed</div>
                      <div className="num font-display text-lg">{p.totalExecuted}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-graphite text-xs">spent</div>
                      <div className="num font-display text-lg">${p.totalSpent.toFixed(2)}</div>
                    </div>
                    <StatusPill tone={p.status === 'active' ? 'live' : p.status === 'paused' ? 'paused' : 'idle'}>
                      {p.status}
                    </StatusPill>
                  </div>
                </div>
                <Squiggle height={8} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="rebalance targets">
        {!reb.data || reb.data.length === 0 ? (
          <EmptyState>no rebalance targets configured</EmptyState>
        ) : (
          <ul className="space-y-3">
            {reb.data.map((t) => (
              <li key={t.id}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="font-display text-lg">{t.chain}</div>
                    <div className="text-graphite text-sm">
                      drift threshold {t.threshold}% · {t.targets.map((x) => `${x.token} ${x.weight}%`).join(' · ')}
                    </div>
                  </div>
                  <StatusPill tone={t.status === 'active' ? 'live' : 'idle'}>{t.status}</StatusPill>
                </div>
                <Squiggle height={8} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="price alerts">
        {!alerts.data || alerts.data.length === 0 ? (
          <EmptyState>no alerts armed</EmptyState>
        ) : (
          <ul className="space-y-3">
            {alerts.data.map((a) => (
              <li key={a.id}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="font-display text-lg">
                      {a.token} {a.direction} {a.threshold}%
                    </div>
                    <div className="text-graphite text-sm">
                      {a.chain} · {a.type}
                      {a.referencePrice !== null && ` · ref $${a.referencePrice.toFixed(4)}`}
                    </div>
                  </div>
                  <StatusPill tone={a.status === 'active' ? 'live' : 'idle'}>{a.status}</StatusPill>
                </div>
                <Squiggle height={8} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
