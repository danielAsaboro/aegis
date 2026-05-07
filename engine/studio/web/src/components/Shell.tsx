/**
 * Whole-page shell — header (with the doodle-reveal title), nav strip,
 * and the active page in the center column.
 */

import { motion } from 'framer-motion';
import { Tag } from './Tag';
import { useSignalsConnected } from '../lib/ws';
import { StatusPill } from './StatusPill';
import { useEffect, useState, type ReactNode } from 'react';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'live', label: 'Live feed' },
  { id: 'agent', label: 'Agent runs' },
  { id: 'strategies', label: 'Strategies' },
  { id: 'trades', label: 'Trades' },
  { id: 'logs', label: 'Logs' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

type Props = {
  active: TabId;
  onTabChange: (tab: TabId) => void;
  children: ReactNode;
};

export function Shell({ active, onTabChange, children }: Props) {
  const connected = useSignalsConnected();
  const [bootDone, setBootDone] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setBootDone(true), 700);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="relative min-h-screen">
      <div className="paper-noise" />
      <div className="relative z-10 max-w-[1280px] mx-auto px-8 py-10">
        <header className="flex items-end justify-between mb-10">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="font-display text-5xl tracking-tight text-ink"
            >
              AEGIS Studio
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: bootDone ? 1 : 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="font-hand text-graphite text-xl mt-1"
            >
              what the aegis's up to right now
            </motion.p>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill tone={connected ? 'live' : 'paused'}>
              {connected ? 'live' : 'connecting…'}
            </StatusPill>
          </div>
        </header>

        <nav className="flex gap-2 mb-8 flex-wrap">
          {TABS.map((t) => (
            <Tag key={t.id} active={t.id === active} onClick={() => onTabChange(t.id)}>
              {t.label}
            </Tag>
          ))}
        </nav>

        <motion.main
          key={active}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
        >
          {children}
        </motion.main>

        <footer className="mt-16 text-center font-hand text-graphite text-base opacity-60">
          drawn live on localhost — no servers, no spies
        </footer>
      </div>
    </div>
  );
}
