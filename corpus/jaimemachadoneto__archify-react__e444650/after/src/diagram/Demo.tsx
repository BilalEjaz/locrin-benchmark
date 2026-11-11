import { useState, type FC } from "react";
import WorkflowDiagram from "./WorkflowDiagram";
import type { DiagramSpec } from "./spec";

// Invented specs
const traceSpec: DiagramSpec = {
  version: 1,
  direction: "RIGHT",
  nodes: [
    { id: "start", label: "Start", kind: "start" },
    { id: "dev", label: "Dev", kind: "step" },
    { id: "approve", label: "Approve", kind: "decision" },
    { id: "dev2", label: "Dev 2", kind: "step" },
    { id: "end", label: "End", kind: "end" },
  ],
  edges: [
    { id: "trace-e1", source: "start", target: "dev" },
    { id: "trace-e2", source: "dev", target: "approve" },
    { id: "trace-e3", source: "approve", target: "dev2" },
    { id: "trace-e4", source: "dev2", target: "end" },
  ],
};

const approvalSpec: DiagramSpec = {
  version: 1,
  direction: "RIGHT",
  lanes: [
    { id: "lane1", label: "Lane 1" },
    { id: "lane2", label: "Lane 2" },
  ],
  nodes: [
    { id: "a", label: "A", lane: "lane1" },
    { id: "b", label: "B", lane: "lane1" },
    { id: "c", label: "C", lane: "lane2" },
    { id: "d", label: "D", lane: "lane2" },
  ],
  edges: [
    { id: "approval-e1", source: "a", target: "b" },
    { id: "approval-e2", source: "b", target: "c" },
    { id: "approval-e3", source: "c", target: "d" },
  ],
};

const retrySpec: DiagramSpec = {
  version: 1,
  direction: "DOWN",
  nodes: [
    { id: "start", label: "Start", kind: "start" },
    { id: "step1", label: "Step 1", kind: "step" },
    { id: "decision", label: "Decision", kind: "decision" },
    { id: "retry", label: "Retry", kind: "step" },
    { id: "end", label: "End", kind: "end" },
  ],
  edges: [
    { id: "retry-e1", source: "start", target: "step1" },
    { id: "retry-e2", source: "step1", target: "decision" },
    { id: "retry-e3", source: "decision", target: "retry" },
    { id: "retry-e4", source: "retry", target: "decision" },
    { id: "retry-e5", source: "decision", target: "end" },
  ],
};

const demos: Array<{ title: string; spec: DiagramSpec }> = [
  { title: "Decision trace", spec: traceSpec },
  { title: "Approval with lanes", spec: approvalSpec },
  { title: "Retry loop", spec: retrySpec },
];

// Each diagram keeps its own selection, because node ids repeat between specs.
const DemoDiagram: FC<{ title: string; spec: DiagramSpec }> = ({ title, spec }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <section>
      <h3>{title}</h3>
      <WorkflowDiagram
        spec={spec}
        selectedId={selectedId}
        onSelect={setSelectedId}
        height={300}
        ariaLabel={title}
      />
      <p>{selectedId ? `Selected node: ${selectedId}` : "Select a node to see its id."}</p>
    </section>
  );
};

const Demo: FC = () => (
  <div style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
    <h2>Archify React Diagram Demo</h2>
    {demos.map((demo) => (
      <DemoDiagram key={demo.title} {...demo} />
    ))}
  </div>
);

export default Demo;
