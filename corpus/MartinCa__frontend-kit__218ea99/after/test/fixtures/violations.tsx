// Fixture for the remaining mechanical DESIGN.md rules: no deep relative
// imports, no direct primitive imports, no banned date library, no inline
// style prop, no `any`.
import "../../some/deep/module";
import "@base-ui-components/react/dialog";
import "moment";

export function Widget({ data }: { data: any }) {
  return <div style={{ color: "red" }}>{String(data)}</div>;
}
