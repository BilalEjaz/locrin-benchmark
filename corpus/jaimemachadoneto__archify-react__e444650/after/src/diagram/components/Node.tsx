import type { FC } from "react";
import { Handle, Position, type Node as FlowNode, type NodeProps } from "@xyflow/react";
import type { DiagramNode } from "../spec";

export type DiagramNodeData = {
  label: string;
  state?: DiagramNode["state"];
  selected: boolean;
  onSelect: (id: string) => void;
};

export type DiagramFlowNode = FlowNode<DiagramNodeData, "step">;

// The button is the only click target, so one click calls onSelect once.
// A native button also gives Enter and Space for free.
const Node: FC<NodeProps<DiagramFlowNode>> = ({
  id,
  data,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
}) => {
  const { label, state, selected, onSelect } = data;

  const classes = ["archify-node"];
  if (selected) classes.push("archify-node--selected");
  if (state) classes.push(`archify-node--${state}`);

  return (
    <>
      {/* The layout draws the edges. React Flow needs the handles to place them. */}
      <Handle
        type="target"
        position={targetPosition}
        isConnectable={false}
        className="archify-handle"
        style={{ visibility: "hidden" }}
      />
      <button
        type="button"
        className={classes.join(" ")}
        data-state={state ?? "used"}
        aria-pressed={selected}
        style={{ width: "100%", height: "100%" }}
        onClick={() => onSelect(id)}
      >
        <span className="archify-node__label">{label}</span>
        {state === "skipped" && <span className="archify-node__note">not used</span>}
      </button>
      <Handle
        type="source"
        position={sourcePosition}
        isConnectable={false}
        className="archify-handle"
        style={{ visibility: "hidden" }}
      />
    </>
  );
};

export default Node;
