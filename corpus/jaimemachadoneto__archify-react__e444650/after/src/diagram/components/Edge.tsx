import type { FC, MouseEvent } from "react";
import { useMediaQuery } from "react-responsive";

interface EdgeProps {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated: boolean;
  onSelect?: (id: string) => void;
  className?: string;
}

// TODO: Task 6 draws the line from the path of the layout and moves the dot along it.
const Edge: FC<EdgeProps> = ({ id, label, animated, onSelect, className }) => {
  const prefersReducedMotion = useMediaQuery({ query: "(prefers-reduced-motion: reduce)" });

  const handleClick = (e: MouseEvent<SVGGElement>) => {
    e.stopPropagation();
    onSelect?.(id);
  };

  return (
    <g
      className={className}
      onClick={handleClick}
      style={{
        cursor: "pointer",
        ...(prefersReducedMotion && {
          pointerEvents: "none",
        }),
      }}
    >
      <line
        x1={0}
        y1={0}
        x2={0}
        y2={0}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="edge-line"
        data-testid="edge-line"
      />
      {animated && !prefersReducedMotion && (
        <circle r={3} fill="currentColor">
          <animateMotion dur="2s" repeatCount="indefinite" path="M0,0 L0,0" />
        </circle>
      )}
      {label && (
        <text x={50} y={-5} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
};

export default Edge;
