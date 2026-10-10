import { defineScreens } from "../../shell/registry";
import { Glass } from "./Glass";
import { Search } from "./Search";
import { SFSymbols } from "./SFSymbols";
import { SidebarDataItems, SidebarDynamicHeights, SidebarReactRows } from "./Sidebar";
import { SplitView } from "./SplitView";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("native-controls", [
  { id: "sidebar-data-items", title: "Sidebar: data items", summary: "Native sidebar rows from data, with a non-selectable row and content layout events.", component: SidebarDataItems },
  { id: "sidebar-dynamic-heights", title: "Sidebar: dynamic heights", summary: "React sidebar rows whose heights follow React layout.", component: SidebarDynamicHeights },
  { id: "sidebar-react-rows", title: "Sidebar: React rows", summary: "Fixed-height React rows with context-menu events.", component: SidebarReactRows },
  { id: "split-view", title: "Split view", summary: "A native sidebar split view with React sidebar and content panes.", component: SplitView },
  { id: "glass", title: "Glass", summary: "A native glass effect view.", component: Glass },
  { id: "symbol", title: "SF Symbols", summary: "SF Symbols at several sizes, scales and colors.", component: SFSymbols },
  { id: "search", title: "Search field", summary: "Native search fields with change events and programmatic focus.", component: Search },
]);
