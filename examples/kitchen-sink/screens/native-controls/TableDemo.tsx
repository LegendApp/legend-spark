import { Checkbox } from "@legendapp/spark/ui";
import { Table, type TableRow } from "@legendapp/spark/ui/table";
import { useMemo, useState } from "react";
import { Panel, Status, errorText } from "../../Panel";

const AUTHORS = ["Jay", "Ada", "Linus", "Grace"];
const columns = [
  { id: "subject", title: "Subject", minWidth: 200 },
  { id: "author", title: "Author", width: 110, secondary: true },
  { id: "date", title: "Date", width: 110, alignment: "trailing", monospacedDigits: true, secondary: true },
] as const;

export function TableDemo() {
  const rows = useMemo<TableRow[]>(() => Array.from({ length: 5000 }, (_, index) => ({ id: `c${index}`, values: { subject: `Commit ${5000 - index}: change ${index % 7 === 0 ? "the sidebar tree" : "a native control"}`, author: AUTHORS[index % AUTHORS.length]!, date: `2026-11-${String(28 - (index % 28)).padStart(2, "0")}` } })), []);
  const [multiple, setMultiple] = useState(false);
  const [selected, setSelected] = useState<string[]>(["c0"]);
  const [status, setStatus] = useState("5,000 rows; only visible rows have cells");
  const select = ({ ids }: { ids: string[] }) => { setSelected(ids); setStatus(`Selected: ${ids.join(", ") || "none"}`); };
  const common = { testID: "native-controls-table", accessibilityLabel: "Commits", columns, rows, alternatingRows: true, onSelectionChange: select, onDoubleClick: ({ id }: { id: string }) => setStatus(`Double-clicked: ${id}`), onError: (error: unknown) => setStatus(errorText(error)), style: { height: 320, alignSelf: "stretch" } } as const;
  return <Panel title="Table">
    <Status testID="native-controls-table-status">{status}</Status>
    <Checkbox testID="native-controls-table-multiple" value={multiple} onValueChange={value => { setMultiple(value); setSelected(selected.slice(0, 1)); }}>Multiple selection (⌘/⇧-click)</Checkbox>
    {multiple ? <Table {...common} selectedIds={selected} /> : <Table {...common} selectedId={selected[0] ?? null} />}
  </Panel>;
}
