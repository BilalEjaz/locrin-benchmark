import { useEffect, useMemo, useState, type FC } from "react";
import { Background, Controls, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutDiagram, type LayoutResult } from "./layout";
import type { DiagramSpec } from "./spec";
import { validateSpec } from "./validate";
import Node, { type DiagramFlowNode } from "./components/Node";
import Lane, { type LaneFlowNode } from "./components/Lane";
import FlowEdgeView, { type DiagramFlowEdge } from "./components/FlowEdge";

export interface WorkflowDiagramProps {
  spec: DiagramSpec;
  selectedId: string | null;
  onSelect: (id: string) => void;
  height: number;
  ariaLabel: string;
}

// Defined outside the component, so React Flow gets the same objects on each render.
const nodeTypes = { step: Node, lane: Lane };
const edgeTypes = { flow: FlowEdgeView };

// The result belongs to one spec. A result for an older spec is never drawn.
type Outcome = { spec: DiagramSpec; layout: LayoutResult } | { spec: DiagramSpec; error: string };

const WorkflowDiagram: FC<WorkflowDiagramProps> = ({
  spec,
  selectedId,
  onSelect,
  height,
  ariaLabel,
}) => {
  const problems = useMemo(() => validateSpec(spec), [spec]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (problems.length > 0) return;
    let cancelled = false;
    layoutDiagram(spec).then(
      (layout) => {
        if (!cancelled) setOutcome({ spec, layout });
      },
      (error: unknown) => {
        if (!cancelled) {
          setOutcome({ spec, error: error instanceof Error ? error.message : String(error) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [spec, problems]);

  const current = outcome?.spec === spec ? outcome : null;
  const wrapper = { height, width: "100%" };

  if (problems.length > 0) {
    return (
      <div role="group" aria-label={ariaLabel} style={wrapper}>
        <div role="alert" className="archify-alert">
          <p>The diagram spec is not valid.</p>
          <ul>
            {problems.map((problem, index) => (
              <li key={`${problem.code}-${index}`}>{problem.message}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (current && "error" in current) {
    return (
      <div role="group" aria-label={ariaLabel} style={wrapper}>
        <div role="alert" className="archify-alert">
          {current.error}
        </div>
      </div>
    );
  }

  if (!current) {
    return <div role="group" aria-label={ariaLabel} style={wrapper} />;
  }

  const { layout } = current;
  const vertical = spec.direction === "DOWN";
  const sourcePosition = vertical ? Position.Bottom : Position.Right;
  const targetPosition = vertical ? Position.Top : Position.Left;
  const laneLabels = new Map(spec.lanes?.map((lane) => [lane.id, lane.label]));

  const laneNodes: LaneFlowNode[] = layout.lanes.map((lane) => ({
    id: `lane:${lane.id}`,
    type: "lane",
    data: { label: laneLabels.get(lane.id) ?? lane.id },
    position: { x: lane.x, y: lane.y },
    width: lane.width,
    height: lane.height,
    zIndex: -1,
    draggable: false,
    selectable: false,
    focusable: false,
    style: { pointerEvents: "none" },
  }));

  const stepNodes: DiagramFlowNode[] = layout.nodes.map((node) => ({
    id: node.id,
    type: "step",
    data: {
      label: node.label,
      state: node.state,
      selected: selectedId === node.id,
      onSelect,
    },
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    sourcePosition,
    targetPosition,
    // React Flow measures the handles in a browser. These boxes keep the edges
    // drawn where no layout engine exists, such as in a test.
    handles: [
      {
        type: "target",
        position: targetPosition,
        x: vertical ? node.width / 2 : 0,
        y: vertical ? 0 : node.height / 2,
        width: 1,
        height: 1,
      },
      {
        type: "source",
        position: sourcePosition,
        x: vertical ? node.width / 2 : node.width,
        y: vertical ? node.height : node.height / 2,
        width: 1,
        height: 1,
      },
    ],
  }));

  const edges: DiagramFlowEdge[] = layout.edges.map((edge) => ({
    id: edge.id,
    type: "flow",
    source: edge.source,
    target: edge.target,
    focusable: false,
    data: {
      label: edge.label,
      state: edge.state,
      animated: edge.animated ?? false,
      sections: edge.sections,
    },
  }));

  return (
    <div role="group" aria-label={ariaLabel} style={wrapper}>
      <ReactFlow<DiagramFlowNode | LaneFlowNode, DiagramFlowEdge>
        nodes={[...laneNodes, ...stepNodes]}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable
        zoomOnScroll={false}
        preventScrolling={false}
        fitView
      >
        <Controls showInteractive={false} />
        <Background />
      </ReactFlow>
    </div>
  );
};

export default WorkflowDiagram;
