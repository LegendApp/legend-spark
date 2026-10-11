import { Sidebar, SidebarItem } from "@legendapp/spark/ui/sidebar";
import { useState } from "react";
import { Text, View } from "react-native";
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
  { detail: "Compact row with fixed content.", height: 34, id: "compact", title: "Compact" },
  { detail: "A medium row demonstrating auto height from React layout.", height: 58, id: "medium", title: "Medium" },
  { detail: "A taller row. Resizing the window should keep the row heights tied to the React item layout.", height: 86, id: "tall", title: "Tall" },
];
// Native views take style; Uniwind classNames apply to React Native core components.
const frame = { height: 210, width: 320, borderRadius: 8, overflow: "hidden" } as const;

function useSelection(initial: string) {
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const [status, setStatus] = useState("No sidebar event yet.");
  const onSelectionChange = ({ id }: { id: string | null }) => { setSelectedId(id); setStatus(`Selected ${id}`); };
  return { selectedId, status, setStatus, onSelectionChange };
}
function Row({ title, detail }: { title: string; detail: string }) {
  return <View className="flex-1 justify-center gap-1 px-3">
    <Text className="text-sm font-bold text-foreground">{title}</Text>
    <Text className="text-xs text-muted">{detail}</Text>
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
      {dynamicRows.map(row => <SidebarItem key={row.id} id={row.id} rowHeight="auto" style={{ height: row.height }}><Row {...row} /></SidebarItem>)}
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
        <Row {...row} />
      </SidebarItem>)}
    </Sidebar>
  </Panel>;
}
