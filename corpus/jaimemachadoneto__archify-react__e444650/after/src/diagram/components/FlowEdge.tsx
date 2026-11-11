import type { FC } from "react";
import { BaseEdge, getSmoothStepPath, type Edge as FlowEdge, type EdgeProps } from "@xyflow/react";
import type { DiagramEdge } from "../spec";
import type { EdgeSection } from "../layout";

export type DiagramEdgeData = {
  label?: string;
  state?: DiagramEdge["state"];
  animated: boolean;
  sections: EdgeSection[];
};

export type DiagramFlowEdge = FlowEdge<DiagramEdgeData, "flow">;

function pathOf(sections: EdgeSection[]): { path: string; labelX: number; labelY: number } | null {
  const points = sections.flatMap((s) => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
  if (points.length < 2) return null;
  const middle = points[Math.floor(points.length / 2)];
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return { path, labelX: middle.x, labelY: middle.y };
}

// TODO: Task 6 moves the dot along the path (data.animated) in components/Edge.tsx.
const FlowEdgeView: FC<EdgeProps<DiagramFlowEdge>> = ({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}) => {
  // Use the route from the layout. Without one, React Flow draws a path between the handles.
  const routed = pathOf(data?.sections ?? []);
  const [fallbackPath, fallbackX, fallbackY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <BaseEdge
      id={id}
      path={routed?.path ?? fallbackPath}
      labelX={routed?.labelX ?? fallbackX}
      labelY={routed?.labelY ?? fallbackY}
      label={data?.label}
      className="archify-edge"
      data-state={data?.state ?? "used"}
    />
  );
};

export default FlowEdgeView;
