import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkflowDiagram from "./WorkflowDiagram";
import type { DiagramSpec } from "./spec";
import { layoutDiagram } from "./layout";

// The spy calls the real layout, so the tests still draw the real result.
// The spy lets a test see that an invalid spec never reaches the layout, and
// lets another test make the layout fail.
vi.mock("./layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./layout")>();
  return { ...actual, layoutDiagram: vi.fn(actual.layoutDiagram) };
});

const baseSpec: DiagramSpec = {
  version: 1,
  nodes: [
    { id: "alpha", label: "Alpha", state: "used" },
    { id: "beta", label: "Beta", state: "used" },
  ],
  edges: [{ id: "e1", source: "alpha", target: "beta" }],
};

const skippedSpec: DiagramSpec = {
  ...baseSpec,
  nodes: [
    { id: "alpha", label: "Alpha", state: "used" },
    { id: "beta", label: "Beta", state: "skipped" },
  ],
};

const laneSpec: DiagramSpec = {
  version: 1,
  lanes: [{ id: "ops", label: "Operations lane" }],
  nodes: [
    { id: "alpha", label: "Alpha", lane: "ops" },
    { id: "beta", label: "Beta", lane: "ops" },
  ],
  edges: [{ id: "e1", source: "alpha", target: "beta" }],
};

const invalidSpec: DiagramSpec = {
  version: 1,
  nodes: [{ id: "alpha", label: "Alpha" }],
  edges: [{ id: "e1", source: "alpha", target: "missing" }],
};

function draw(
  spec: DiagramSpec,
  props: { selectedId?: string | null; onSelect?: (id: string) => void } = {},
) {
  return render(
    <WorkflowDiagram
      spec={spec}
      selectedId={props.selectedId ?? null}
      onSelect={props.onSelect ?? (() => {})}
      height={400}
      ariaLabel="Decision trace"
    />,
  );
}

describe("WorkflowDiagram", () => {
  beforeEach(() => {
    vi.mocked(layoutDiagram).mockClear();
  });

  it("draws each node as a button with aria-pressed false", async () => {
    draw(baseSpec);
    const alpha = await screen.findByRole("button", { name: /Alpha/ });
    const beta = await screen.findByRole("button", { name: /Beta/ });
    expect(alpha).toHaveAttribute("aria-pressed", "false");
    expect(beta).toHaveAttribute("aria-pressed", "false");
    expect(alpha).toHaveAttribute("type", "button");
  });

  it("calls onSelect with the node id exactly once for a click", async () => {
    const onSelect = vi.fn();
    draw(baseSpec, { onSelect });
    // fireEvent sends only the click. userEvent.click also sends a mousedown without
    // a window, which the pan handler of React Flow (d3-zoom) cannot read in jsdom.
    fireEvent.click(await screen.findByRole("button", { name: /Beta/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("beta");
  });

  it("calls onSelect when the user presses Enter on a node", async () => {
    const onSelect = vi.fn();
    draw(baseSpec, { onSelect });
    const alpha = await screen.findByRole("button", { name: /Alpha/ });
    alpha.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("alpha");
  });

  it("calls onSelect when the user presses Space on a node", async () => {
    const onSelect = vi.fn();
    draw(baseSpec, { onSelect });
    const alpha = await screen.findByRole("button", { name: /Alpha/ });
    alpha.focus();
    await userEvent.keyboard(" ");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("alpha");
  });

  it("sets aria-pressed true only on the selected node", async () => {
    draw(baseSpec, { selectedId: "alpha" });
    expect(await screen.findByRole("button", { name: /Alpha/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByRole("button", { name: /Beta/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows the text 'not used' on a skipped node only", async () => {
    draw(skippedSpec);
    const beta = await screen.findByRole("button", { name: /Beta/ });
    const alpha = await screen.findByRole("button", { name: /Alpha/ });
    expect(within(beta).getByText("not used")).toBeInTheDocument();
    expect(within(alpha).queryByText("not used")).not.toBeInTheDocument();
    expect(beta).toHaveAttribute("data-state", "skipped");
  });

  it("draws an edge path from the sections of the layout", async () => {
    const { container } = draw(baseSpec);
    await screen.findByRole("button", { name: /Beta/ });
    const path = container.querySelector(".archify-edge");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("d")).toMatch(/^M [\d.-]+ [\d.-]+ L /);
  });

  it("shows the lane label for a spec with lanes", async () => {
    draw(laneSpec);
    expect(await screen.findByText("Operations lane")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Alpha/ })).toBeInTheDocument();
  });

  it("shows the problems of an invalid spec in an alert and does not lay it out", () => {
    draw(invalidSpec);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/unknown target node "missing"/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(layoutDiagram).not.toHaveBeenCalled();
  });

  it("shows an alert when the layout fails", async () => {
    vi.mocked(layoutDiagram).mockRejectedValueOnce(new Error("ELK could not lay out the graph"));
    draw(baseSpec);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ELK could not lay out the graph");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ignores a layout result for a spec that the caller already replaced", async () => {
    let resolveFirst: (value: Awaited<ReturnType<typeof layoutDiagram>>) => void = () => {};
    const actual = await vi.importActual<typeof import("./layout")>("./layout");
    vi.mocked(layoutDiagram).mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    const staleResult = await actual.layoutDiagram(baseSpec);
    const view = draw(baseSpec);
    view.rerender(
      <WorkflowDiagram
        spec={laneSpec}
        selectedId={null}
        onSelect={() => {}}
        height={400}
        ariaLabel="Decision trace"
      />,
    );
    expect(await screen.findByText("Operations lane")).toBeInTheDocument();
    resolveFirst(staleResult);
    await Promise.resolve();
    expect(screen.getByText("Operations lane")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("puts the aria label and the height on the group", () => {
    draw(baseSpec);
    const group = screen.getByRole("group", { name: "Decision trace" });
    expect(group).toHaveStyle({ height: "400px" });
  });
});
