/**
 * Thin React wrapper around a Sigma v3 instance. Accepts a Graphology graph
 * and calls out when a node is clicked, hovered, or double-clicked (expand).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Sigma from 'sigma';
import type { Settings } from 'sigma/settings';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';
import type Graph from 'graphology';

export interface SigmaGraphHandle {
  /** Compose the current canvases into a PNG data URL. */
  toPngDataURL(): string | null;
}

/**
 * Dark-theme hover label. Sigma's default draws an opaque white rectangle
 * with our light-gray label color on top — invisible on a dark canvas.
 * This draws a translucent dark pill with a thin accent border and bright text.
 */
function drawNodeHoverDark(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
  settings: Settings
) {
  const size = settings.labelSize;
  const font = settings.labelFont;
  const weight = settings.labelWeight;
  context.font = `${weight} ${size}px ${font}`;

  const PADDING_X = 6;
  const PADDING_Y = 4;
  const label = typeof data.label === 'string' ? data.label : '';
  const textWidth = label ? context.measureText(label).width : 0;
  const boxWidth = Math.round(textWidth + PADDING_X * 2);
  const boxHeight = Math.round(size + PADDING_Y * 2);
  const boxX = data.x + data.size + 4;
  const boxY = data.y - boxHeight / 2;
  const radius = 4;

  // Rounded-rect pill
  context.fillStyle = 'rgba(17, 24, 39, 0.95)'; // --color-surface-2-ish
  context.strokeStyle = '#f59e0b'; // --color-accent
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(boxX + radius, boxY);
  context.lineTo(boxX + boxWidth - radius, boxY);
  context.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
  context.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
  context.quadraticCurveTo(
    boxX + boxWidth,
    boxY + boxHeight,
    boxX + boxWidth - radius,
    boxY + boxHeight
  );
  context.lineTo(boxX + radius, boxY + boxHeight);
  context.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
  context.lineTo(boxX, boxY + radius);
  context.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
  context.closePath();
  context.fill();
  context.stroke();

  // Ring around the hovered node itself
  context.beginPath();
  context.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2);
  context.strokeStyle = '#f59e0b';
  context.lineWidth = 1.5;
  context.stroke();

  if (label) {
    context.fillStyle = '#f3f4f6';
    context.textBaseline = 'middle';
    context.fillText(label, boxX + PADDING_X, boxY + boxHeight / 2 + 0.5);
  }
}

interface Props {
  graph: Graph;
  /** Node id currently selected (highlighted) */
  selectedNode?: string | null;
  /** Set of node ids that have been manually expanded */
  expandedNodes?: ReadonlySet<string>;
  onNodeClick?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  onBackgroundClick?: () => void;
}

export const SigmaGraph = forwardRef<SigmaGraphHandle, Props>(function SigmaGraph(
  {
    graph,
    selectedNode,
    expandedNodes,
    onNodeClick,
    onNodeDoubleClick,
    onBackgroundClick,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const hoveredRef = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    toPngDataURL(): string | null {
      const container = containerRef.current;
      if (!container) return null;
      const canvases = container.querySelectorAll('canvas');
      if (canvases.length === 0) return null;
      const first = canvases[0];
      const out = document.createElement('canvas');
      out.width = first.width;
      out.height = first.height;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      // dark background matching --color-bg
      ctx.fillStyle = '#0a0a0b';
      ctx.fillRect(0, 0, out.width, out.height);
      canvases.forEach((c) => {
        ctx.drawImage(c, 0, 0);
      });
      return out.toDataURL('image/png');
    },
  }));

  // Create / destroy Sigma instance when graph reference changes.
  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelFont: 'Inter, ui-sans-serif, system-ui, sans-serif',
      labelSize: 11,
      labelWeight: '500',
      labelColor: { color: '#e5e7eb' },
      defaultDrawNodeHover: drawNodeHoverDark,
      labelDensity: 0.5,
      labelGridCellSize: 100,
      labelRenderedSizeThreshold: 8,
      defaultNodeColor: '#9ca3af',
      defaultEdgeColor: '#1f2937',
      minCameraRatio: 0.1,
      maxCameraRatio: 10,
      nodeReducer: (node, data) => {
        const res: Record<string, unknown> = { ...data };
        const hovered = hoveredRef.current;
        if (hovered && hovered !== node) {
          const neighbors = graph.neighbors(hovered);
          if (!neighbors.includes(node)) {
            res.color = '#374151';
            res.label = '';
          }
        }
        if (selectedNode === node) {
          res.highlighted = true;
          res.size = (data.size as number) * 1.4;
        }
        if (expandedNodes?.has(node)) {
          res.forceLabel = true;
        }
        return res;
      },
      edgeReducer: (edge, data) => {
        const res: Record<string, unknown> = { ...data };
        const hovered = hoveredRef.current;
        if (hovered) {
          const [s, t] = graph.extremities(edge);
          if (s !== hovered && t !== hovered) {
            res.hidden = true;
          } else {
            res.color = '#f59e0b';
          }
        }
        return res;
      },
    });
    sigmaRef.current = renderer;

    renderer.on('clickNode', ({ node }) => {
      onNodeClick?.(node);
    });
    renderer.on('doubleClickNode', ({ node, event }) => {
      event.preventSigmaDefault();
      onNodeDoubleClick?.(node);
    });
    renderer.on('clickStage', () => {
      onBackgroundClick?.();
    });
    renderer.on('enterNode', ({ node }) => {
      hoveredRef.current = node;
      renderer.refresh({ skipIndexation: true });
    });
    renderer.on('leaveNode', () => {
      hoveredRef.current = null;
      renderer.refresh({ skipIndexation: true });
    });

    return () => {
      renderer.kill();
      sigmaRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Re-render when selection or expansion changes (reducers read from closures).
  useEffect(() => {
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [selectedNode, expandedNodes]);

  return <div ref={containerRef} className="w-full h-full" />;
});
