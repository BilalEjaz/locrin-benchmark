import type { FC } from "react";
import type { Node as FlowNode, NodeProps } from "@xyflow/react";

export type LaneNodeData = {
  label: string;
};

export type LaneFlowNode = FlowNode<LaneNodeData, "lane">;

const Lane: FC<NodeProps<LaneFlowNode>> = ({ data }) => (
  <div className="archify-lane" style={{ width: "100%", height: "100%" }}>
    <span className="archify-lane__label">{data.label}</span>
  </div>
);

export default Lane;
