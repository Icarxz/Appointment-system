import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// Shows `wide` when this block is at least `min` pixels wide, otherwise `narrow`.
// It measures the block itself, not the window, because the sidebar takes a different share of the screen at
// every size: a wide table that fits on a 1366px laptop is clipped at 1280px, and a card list is better there.
export default function ByWidth({ min = 900, wide, narrow }: { min?: number; wide: ReactNode; narrow: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isWide, setIsWide] = useState<boolean | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setIsWide(el.clientWidth >= min);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);

  return <div ref={ref} style={{ width: '100%', minWidth: 0 }}>{isWide === null ? null : isWide ? wide : narrow}</div>;
}
