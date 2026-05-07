import { RoughOval } from '../lib/rough';

type Tone = 'live' | 'idle' | 'paused' | 'success' | 'failure' | 'pending' | 'info';

const TONES: Record<Tone, { fill: string; label?: string }> = {
  live: { fill: 'var(--mint)' },
  idle: { fill: 'var(--paper-edge)' },
  paused: { fill: 'var(--peach)' },
  success: { fill: 'var(--mint)' },
  failure: { fill: 'var(--blush)' },
  pending: { fill: 'var(--peach)' },
  info: { fill: 'var(--sky)' },
};

export function StatusPill({ tone = 'info', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <RoughOval fill={TONES[tone].fill}>
      <span className="font-display text-sm tracking-tight">{children}</span>
    </RoughOval>
  );
}
