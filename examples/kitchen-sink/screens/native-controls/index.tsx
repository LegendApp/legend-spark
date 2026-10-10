import { defineScreens } from "../../shell/registry";
import { Buttons, Indicators, Inputs, Toggles } from "./ControlPrimitives";
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
  { id: "toggles", title: "Toggles", summary: "Checkbox (with mixed), radio group, switch and disclosure triangle in every control size.", component: Toggles },
  { id: "inputs", title: "Value inputs", summary: "Continuous and ticked sliders, stepper, combo box, token field and path control in every control size.", component: Inputs },
  { id: "indicators", title: "Indicators", summary: "Determinate, indeterminate and spinner progress and a level indicator, driven by a stepper.", component: Indicators },
  { id: "buttons", title: "Button styles", summary: "Push, bevel, toolbar, help and destructive buttons in every size; Return and Escape buttons.", component: Buttons },
]);
