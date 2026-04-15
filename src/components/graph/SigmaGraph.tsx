/**
 * Thin React wrapper around a Sigma v3 instance. Accepts a Graphology graph
 * and calls out when a node is clicked, hovered, or double-clicked (expand).
 */
import { useEffect, useRef } from 'react';
import Sigma from 'sigma';
import type Graph from 'graphology';

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

export function SigmaGraph({
  graph,
  selectedNode,
  expandedNodes,
  onNodeClick,
  onNodeDoubleClick,
  onBackgroundClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const hoveredRef = useRef<string | null>(null);

  // Create / destroy Sigma instance when graph reference changes.
  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelFont: 'Inter, ui-sans-serif, system-ui, sans-serif',
      labelSize: 11,
      labelWeight: '500',
      labelColor: { color: '#e5e7eb' },
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
}
