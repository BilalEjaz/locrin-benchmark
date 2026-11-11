import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Edge from "./components/Edge";

describe("Edge", () => {
  it("renders edge with label", () => {
    render(<Edge id="e1" source="a" target="b" label="Test Label" animated={false} />);
    expect(screen.getByText("Test Label")).toBeInTheDocument();
  });

  it("renders animated edge", () => {
    render(<Edge id="e2" source="a" target="b" animated={true} />);
    expect(screen.getByTestId("edge-line")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(<Edge id="e3" source="a" target="b" animated={false} onSelect={onSelect} />);
    const edge = screen.getByTestId("edge-line");
    fireEvent.click(edge);
    expect(onSelect).toHaveBeenCalledWith("e3");
  });
});
