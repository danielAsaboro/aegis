import { useQuery } from '@tanstack/react-query';
import { jsonGet } from '../lib/api';
import { Panel } from '../components/Panel';
import { EmptyState } from '../components/EmptyState';
import { StatusPill } from '../components/StatusPill';
import { Squiggle } from '../lib/rough';

type Trade = {
  id: string;
  strategyType: string;
  fromToken: string;
  toToken: string;
  amount: string;
  chain: string;
  reason: string;
  success: boolean;
  txHash: string | null;
  errorMsg: string | null;
  estimatedOutput: string | null;
  createdAt: string;
  isPrivate: boolean;
};

const EXPLORERS: Record<string, (tx: string) => string> = {
  ethereum: (tx) => `https://etherscan.io/tx/${tx}`,
  base: (tx) => `https://basescan.org/tx/${tx}`,
  arbitrum: (tx) => `https://arbiscan.io/tx/${tx}`,
  optimism: (tx) => `https://optimistic.etherscan.io/tx/${tx}`,
  polygon: (tx) => `https://polygonscan.com/tx/${tx}`,
  solana: (tx) => `https://explorer.solana.com/tx/${tx}`,
};

function explorerUrl(chain: string, tx: string) {
  const fn = EXPLORERS[chain];
  return fn ? fn(tx) : `https://www.google.com/search?q=${tx}`;
}

export default function TradesPage() {
  const { data } = useQuery({
    queryKey: ['trades'],
    queryFn: () => jsonGet<{ rows: Trade[]; totals: { success: number; failure: number } }>('/api/trades'),
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <Panel
        title="trades"
        sideNote={data ? `${data.totals.success} ✓ · ${data.totals.failure} ✗` : ''}
      >
        {!data || data.rows.length === 0 ? (
          <EmptyState>no trades today. take a walk?</EmptyState>
        ) : (
          <ul className="space-y-3">
            {data.rows.map((t) => (
              <li key={t.id}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-display text-base">
                      {t.amount} {t.fromToken} → {t.toToken}
                      {t.isPrivate && (
                        <span className="ml-2 font-hand text-sm text-lavender">private</span>
                      )}
                    </div>
                    <div className="text-graphite text-sm">
                      {t.chain} · {t.strategyType} · <span className="font-hand">{t.reason}</span>
                    </div>
                    {t.errorMsg && <div className="text-blush text-xs mt-1">{t.errorMsg}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    {t.txHash ? (
                      <a
                        href={explorerUrl(t.chain, t.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-graphite hover:text-ink underline decoration-dotted text-xs num"
                      >
                        {t.txHash.slice(0, 8)}…{t.txHash.slice(-6)}
                      </a>
                    ) : (
                      <span className="text-graphite text-xs">no hash</span>
                    )}
                    <StatusPill tone={t.success ? 'success' : 'failure'}>
                      {t.success ? 'ok' : 'failed'}
                    </StatusPill>
                  </div>
                </div>
                <div className="text-graphite text-xs mt-1 num">{new Date(t.createdAt).toLocaleString()}</div>
                <Squiggle height={8} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
