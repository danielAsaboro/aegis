/**
 * Standard whiteboard panel — a Rough.js sketch container with a
 * label-tab title that sits OUTSIDE the panel border (top-left).
 */

import { Sketch } from '../lib/rough';
import type { ReactNode } from 'react';

type Props = {
  title?: ReactNode;
  sideNote?: string;
  children: ReactNode;
  className?: string;
  fill?: string;
  fillStyle?: 'hachure' | 'solid' | 'cross-hatch';
  innerClassName?: string;
};

export function Panel({ title, sideNote, children, className = '', fill, fillStyle, innerClassName = '' }: Props) {
  return (
    <div className={`relative ${className}`}>
      {title && (
        <div className="absolute -top-3 left-6 z-10 flex items-baseline gap-3 bg-paper px-2">
          <span className="font-display text-base tracking-tight text-ink">{title}</span>
          {sideNote && <span className="font-hand text-graphite text-base">{sideNote}</span>}
        </div>
      )}
      <Sketch fill={fill} fillStyle={fillStyle} radius={16} roughness={1.6}>
        <div className={`p-6 ${innerClassName}`}>{children}</div>
      </Sketch>
    </div>
  );
}
