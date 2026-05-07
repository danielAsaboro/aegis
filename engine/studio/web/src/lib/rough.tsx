/**
 * Rough.js wrappers — every panel border in the UI is rendered through
 * <Sketch>, every divider is a <Squiggle>, every status pill is a
 * <RoughOval>. Each component re-seeds Rough's RNG once on mount so the
 * wobble is stable across renders (otherwise hover/state changes induce
 * nausea).
 */

import { useLayoutEffect, useRef, useMemo, type ReactNode, type CSSProperties } from 'react';
import rough from 'roughjs';

let _seedCounter = 1;
function nextSeed() {
  return _seedCounter++;
}

type SketchProps = {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  fill?: string;
  fillStyle?: 'hachure' | 'solid' | 'cross-hatch' | 'zigzag' | 'dots' | 'dashed';
  stroke?: string;
  strokeWidth?: number;
  roughness?: number;
  bowing?: number;
  radius?: number;
  rotate?: number;
  /** When true, renders a slightly rotated sticky-note variant. */
  sticky?: boolean;
};

/**
 * Hand-drawn panel — renders a Rough.js rounded rectangle that contains
 * arbitrary children. Resizes with the container via ResizeObserver.
 */
export function Sketch({
  className = '',
  style,
  children,
  fill,
  fillStyle = 'solid',
  stroke = 'var(--ink)',
  strokeWidth = 1.6,
  roughness = 1.4,
  bowing = 1.6,
  radius = 14,
  rotate = 0,
  sticky = false,
}: SketchProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const seed = useMemo(() => nextSeed(), []);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    if (!wrap || !svg) return;
    const draw = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (width < 4 || height < 4) return;
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const rc = rough.svg(svg);
      const inset = strokeWidth + 2;
      // Rounded rectangle approximated via Rough.js path so corners
      // wobble like everything else.
      const r = Math.min(radius, height / 2, width / 2);
      const w = width - inset * 2;
      const h = height - inset * 2;
      const x = inset;
      const y = inset;
      const path = `M ${x + r} ${y} h ${w - r * 2} q ${r} 0 ${r} ${r} v ${h - r * 2} q 0 ${r} -${r} ${r} h -${w - r * 2} q -${r} 0 -${r} -${r} v -${h - r * 2} q 0 -${r} ${r} -${r} z`;
      const node = rc.path(path, {
        roughness,
        bowing,
        stroke: resolveCssVar(stroke),
        strokeWidth,
        fill: fill ? resolveCssVar(fill) : undefined,
        fillStyle,
        fillWeight: 1.2,
        hachureGap: 8,
        seed,
      });
      svg.appendChild(node);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fill, fillStyle, stroke, strokeWidth, roughness, bowing, radius, seed]);

  const stickyRotation = sticky && rotate === 0 ? ((seed % 20) - 10) / 10 : rotate;

  return (
    <div
      ref={wrapRef}
      className={`relative ${className}`}
      style={{
        transform: stickyRotation ? `rotate(${stickyRotation}deg)` : undefined,
        ...style,
      }}
    >
      <svg
        ref={svgRef}
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

type SquiggleProps = {
  width?: number | string;
  height?: number;
  className?: string;
  stroke?: string;
  strokeWidth?: number;
};

/** A single hand-drawn divider line — used between rows. */
export function Squiggle({
  width = '100%',
  height = 12,
  className = '',
  stroke = 'var(--graphite)',
  strokeWidth = 1.2,
}: SquiggleProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const seed = useMemo(() => nextSeed(), []);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    if (!wrap || !svg) return;
    const draw = () => {
      const w = wrap.getBoundingClientRect().width;
      const h = height;
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const rc = rough.svg(svg);
      const node = rc.line(2, h / 2, w - 2, h / 2, {
        stroke: resolveCssVar(stroke),
        strokeWidth,
        roughness: 2.4,
        bowing: 3,
        seed,
      });
      svg.appendChild(node);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [stroke, strokeWidth, height, seed]);

  return (
    <div
      ref={wrapRef}
      className={`pointer-events-none ${className}`}
      style={{ width, height }}
    >
      <svg ref={svgRef} aria-hidden="true" />
    </div>
  );
}

type RoughOvalProps = {
  className?: string;
  fill?: string;
  stroke?: string;
  children?: ReactNode;
};

/** Small pill — used for status badges. Sized to its content. */
export function RoughOval({
  className = '',
  fill = 'var(--mint)',
  stroke = 'var(--ink)',
  children,
}: RoughOvalProps) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const seed = useMemo(() => nextSeed(), []);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    if (!wrap || !svg) return;
    const draw = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (width < 4 || height < 4) return;
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const rc = rough.svg(svg);
      const node = rc.ellipse(width / 2, height / 2, width - 6, height - 4, {
        fill: resolveCssVar(fill),
        fillStyle: 'solid',
        stroke: resolveCssVar(stroke),
        strokeWidth: 1.4,
        roughness: 1.3,
        bowing: 2,
        seed,
      });
      svg.appendChild(node);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fill, stroke, seed]);

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex items-center justify-center px-3 py-0.5 ${className}`}
    >
      <svg
        ref={svgRef}
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
      />
      <span className="relative z-10">{children}</span>
    </span>
  );
}

/** Hand-drawn underline that animates draw-on. Used to highlight new
 * rows in the live feed when they arrive. */
export function RoughUnderline({ width = 80, color = 'var(--butter)' }: { width?: number; color?: string }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const seed = useMemo(() => nextSeed(), []);

  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const rc = rough.svg(svg);
    const node = rc.line(2, 6, width - 2, 6, {
      stroke: resolveCssVar(color),
      strokeWidth: 4,
      roughness: 2.8,
      bowing: 2,
      seed,
    });
    // Animate stroke draw-on.
    const path = node.querySelector('path');
    if (path) {
      const len = (path as SVGPathElement).getTotalLength?.() ?? 100;
      path.setAttribute('stroke-dasharray', String(len));
      path.setAttribute('stroke-dashoffset', String(len));
      path.style.transition = 'stroke-dashoffset 280ms ease-out';
      requestAnimationFrame(() => {
        path.setAttribute('stroke-dashoffset', '0');
      });
    }
    svg.appendChild(node);
  }, [width, color, seed]);

  return <svg ref={ref} width={width} height={12} aria-hidden="true" />;
}

/* CSS variables aren't valid SVG color tokens, so resolve them at
 * draw-time. Falls back to the raw string when no var() prefix. */
function resolveCssVar(input: string): string {
  if (!input.startsWith('var(')) return input;
  const name = input.slice(4, -1).trim();
  const computed = getComputedStyle(document.documentElement).getPropertyValue(name);
  return computed.trim() || input;
}
