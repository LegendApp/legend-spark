import { Sidebar, SidebarItem } from "@legendapp/spark/ui/sidebar";
import { SFSymbol } from "@legendapp/spark/ui/symbol";
import { useState } from "react";
import { Button, Text, View } from "react-native";
import { Panel, Status } from "../../Panel";

const dataItems = [
  { id: "library", label: "Library" },
  { id: "playlists", label: "Playlists" },
  { id: "artists", label: "Artists" },
  { id: "downloads", label: "Downloads" },
  { id: "disabled", selectable: false, label: "Disabled Row" },
];
const reactRows = [
  { detail: "5 albums", id: "albums", title: "Albums" },
  { detail: "23 playlists", id: "mixes", title: "Mixes" },
  { detail: "Updated today", id: "recent", title: "Recently Added" },
];
const dynamicRows = [
  { detail: "Compact row with fixed content.", minHeight: 34, id: "compact", title: "Compact" },
  { detail: "A medium row demonstrating auto height from React layout.", minHeight: 58, id: "medium", title: "Medium" },
  { detail: "A taller row. Resizing the window should keep the row heights tied to the React item layout.", minHeight: 86, id: "tall", title: "Tall" },
];
// Native views take style; Uniwind classNames apply to React Native core components.
const frame = { height: 210, width: 320, borderRadius: 8, overflow: "hidden" } as const;

function useSelection(initial: string) {
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const [status, setStatus] = useState("No sidebar event yet.");
  const onSelectionChange = ({ id }: { id: string | null }) => { setSelectedId(id); setStatus(`Selected ${id}`); };
  return { selectedId, status, setStatus, onSelectionChange };
}
// The selected row's detail uses the foreground colour: muted text is too faint on the selection.
function Row({ title, detail, selected }: { title: string; detail: string; selected: boolean }) {
  return <View className="grow justify-center gap-1 px-3">
    <Text className="text-sm font-bold text-foreground">{title}</Text>
    <Text className={`text-xs ${selected ? "text-foreground" : "text-muted"}`}>{detail}</Text>
  </View>;
}

export function SidebarDataItems() {
  const { selectedId, status, setStatus, onSelectionChange } = useSelection("library");
  return <Panel title="Sidebar data items">
    <Status testID="native-controls-sidebar-data-items-selected">Selected: {selectedId}</Status>
    <Status testID="native-controls-sidebar-data-items-status">{status}</Status>
    <Sidebar testID="native-controls-sidebar-data-items-list" style={frame} defaultRowHeight={30} items={dataItems} selectedId={selectedId} onSelectionChange={onSelectionChange}
      onContentLayout={({ width, height }) => setStatus(`Layout: ${Math.round(width)}x${Math.round(height)}`)} />
  </Panel>;
}

export function SidebarDynamicHeights() {
  const { selectedId, status, onSelectionChange } = useSelection("compact");
  return <Panel title="Sidebar dynamic heights">
    <Status testID="native-controls-sidebar-dynamic-heights-selected">Selected: {selectedId}</Status>
    <Status testID="native-controls-sidebar-dynamic-heights-status">{status}</Status>
    <Sidebar testID="native-controls-sidebar-dynamic-heights-list" style={frame} defaultRowHeight={28} selectedId={selectedId} onSelectionChange={onSelectionChange}>
      {dynamicRows.map(row => <SidebarItem key={row.id} id={row.id} rowHeight="auto" style={{ minHeight: row.minHeight }}><Row {...row} selected={selectedId === row.id} /></SidebarItem>)}
    </Sidebar>
  </Panel>;
}

export function SidebarReactRows() {
  const { selectedId, status, setStatus, onSelectionChange } = useSelection("albums");
  return <Panel title="Sidebar React rows">
    <Status testID="native-controls-sidebar-react-rows-selected">Selected: {selectedId}</Status>
    <Status testID="native-controls-sidebar-react-rows-status">{status}</Status>
    <Sidebar testID="native-controls-sidebar-react-rows-list" style={frame} defaultRowHeight={44} selectedId={selectedId} onSelectionChange={onSelectionChange}>
      {reactRows.map(row => <SidebarItem key={row.id} id={row.id} rowHeight={44} style={{ height: 44 }}
        onContextMenu={({ windowPosition }) => setStatus(`Right clicked ${row.id} at ${Math.round(windowPosition.x)}, ${Math.round(windowPosition.y)}`)}>
        <Row {...row} selected={selectedId === row.id} />
      </SidebarItem>)}
    </Sidebar>
  </Panel>;
}

// A content list (files, commits) rather than a window sidebar: plain table style with standard selection.
export function SidebarPlainList() {
  const { selectedId, status, onSelectionChange } = useSelection("playlists");
  return <Panel title="Sidebar: plain list">
    <Status testID="native-controls-sidebar-plain-selected">Selected: {selectedId}</Status>
    <Status testID="native-controls-sidebar-plain-status">{status}</Status>
    <Sidebar testID="native-controls-sidebar-plain-list" listStyle="plain" style={frame} defaultRowHeight={24} items={dataItems} selectedId={selectedId} onSelectionChange={onSelectionChange} />
  </Panel>;
}

// A source list with section headers (group rows), a nested remote, trailing counts and collapsible sections.
const treeItems = [
  { id: "repo", label: "legend-spark", group: true, children: [{ id: "changes", label: "Changes", count: 5 }, { id: "history", label: "History" }] },
  { id: "branches", label: "Branches", group: true, children: [{ id: "main", label: "main" }, { id: "feature", label: "feature/sidebar", count: 3 }] },
  { id: "remotes", label: "Remotes", group: true, children: [{ id: "origin", label: "origin", children: [{ id: "origin/main", label: "main" }, { id: "origin/feature", label: "feature/sidebar" }] }] },
  { id: "stashes", label: "Stashes", group: true, children: [{ id: "stash0", label: "WIP on main", count: 2 }] },
];

export function SidebarTree() {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(["changes"]);
  const [multiple, setMultiple] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<readonly string[]>(["stashes"]);
  const [status, setStatus] = useState("No sidebar event yet.");
  const selection = multiple ? { selectedIds } : { selectedId: selectedIds[0] ?? null };
  return <Panel title="Sidebar tree">
    <Status testID="native-controls-sidebar-tree-selected">Selected: {selectedIds.join(", ") || "none"}</Status>
    <Status testID="native-controls-sidebar-tree-status">{status}</Status>
    <Button testID="native-controls-sidebar-tree-multiple" title={multiple ? "Single selection" : "Multiple selection"} onPress={() => { setMultiple(value => !value); setSelectedIds(ids => ids.slice(0, 1)); }} />
    <Sidebar testID="native-controls-sidebar-tree-list" style={{ ...frame, height: 320 }} items={treeItems} {...selection} collapsedIds={collapsedIds}
      onSelectionChange={({ id, ids }) => { setSelectedIds(ids); setStatus(`Selected ${id ?? "none"} (${ids.length})`); }}
      onExpandedChange={({ id, expanded }) => { setCollapsedIds(ids => expanded ? ids.filter(value => value !== id) : [...ids, id]); setStatus(`${expanded ? "Expanded" : "Collapsed"} ${id}`); }}
      onDoubleClick={({ id }) => setStatus(`Double-clicked ${id}`)} />
  </Panel>;
}

// The same tree from React rows: parentId nests a row, group marks a section header, count adds the trailing count.
export function SidebarTreeReactRows() {
  const [selectedId, setSelectedId] = useState<string | null>("wt-main");
  const [status, setStatus] = useState("No sidebar event yet.");
  return <Panel title="Sidebar tree: React rows">
    <Status testID="native-controls-sidebar-tree-react-status">{status}</Status>
    <Sidebar testID="native-controls-sidebar-tree-react-list" style={frame} selectedId={selectedId} onSelectionChange={({ id }) => { setSelectedId(id); setStatus(`Selected ${id}`); }}
      onDoubleClick={({ id }) => setStatus(`Double-clicked ${id}`)} onExpandedChange={({ id, expanded }) => setStatus(`${expanded ? "Expanded" : "Collapsed"} ${id}`)}>
      <SidebarItem id="worktrees" group><Text className="px-1 text-xs font-semibold text-muted">Worktrees</Text></SidebarItem>
      {[{ id: "wt-main", name: "legend-spark", count: 4 }, { id: "wt-docs", name: "legend-spark-docs" }].map(row =>
        <SidebarItem key={row.id} id={row.id} parentId="worktrees" count={row.count}>
          <View className="grow flex-row items-center gap-2 px-1"><SFSymbol name="folder" size={14} /><Text className="text-sm text-foreground" numberOfLines={1}>{row.name}</Text></View>
        </SidebarItem>)}
    </Sidebar>
  </Panel>;
}
