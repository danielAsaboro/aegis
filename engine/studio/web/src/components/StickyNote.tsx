/**
 * Sticky-note KPI card — butter-yellow Rough.js panel with a tape strip
 * up top. Used for headline numbers on the Overview.
 */

import { motion } from 'framer-motion';
import { Sketch } from '../lib/rough';
import type { ReactNode } from 'react';

type Props = {
  label: string;
  value: ReactNode;
  hint?: string;
  rotate?: number;
  fill?: string;
};

export function StickyNote({ label, value, hint, rotate, fill = 'var(--butter)' }: Props) {
  return (
    <motion.div
      whileHover={{ rotate: [(rotate ?? 0), (rotate ?? 0) + 1.5, (rotate ?? 0) - 1, (rotate ?? 0)], transition: { duration: 0.28 } }}
      className="relative"
    >
      <Sketch
        sticky
        rotate={rotate}
        fill={fill}
        fillStyle="hachure"
        radius={10}
        roughness={1.6}
        className="min-h-[140px] p-6 pt-8"
      >
        <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-16 h-3 tape" />
        <div className="text-graphite text-sm font-hand">{label}</div>
        <div className="font-display text-5xl text-ink mt-1 num">{value}</div>
        {hint && <div className="text-graphite text-xs mt-2">{hint}</div>}
      </Sketch>
    </motion.div>
  );
}
