/**
 * Observable Plot wrapper. Takes a plot options object and renders it into a
 * ref'd div. Re-renders on every options change.
 */
import { useEffect, useRef } from 'react';
import * as Plot from '@observablehq/plot';

interface Props {
  options: Plot.PlotOptions;
  className?: string;
}

export function PlotChart({ options, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const plot = Plot.plot({
      style: {
        background: 'transparent',
        color: '#9ca3af',
        fontSize: '10px',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      },
      ...options,
    });
    ref.current.innerHTML = '';
    ref.current.appendChild(plot);
    return () => {
      plot.remove();
    };
  }, [options]);

  return <div ref={ref} className={className} />;
}
