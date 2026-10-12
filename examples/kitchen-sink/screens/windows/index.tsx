import { defineScreens } from "../../shell/registry";
import { WindowControls } from "./WindowControls";
import { WindowManager } from "./WindowManager";
import { WindowOptions } from "./WindowOptions";
import { WindowTabs } from "./WindowTabs";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("windows", [
  { id: "window-manager", title: "Window manager", summary: "Open, resize, rename, blur (macOS) and close a child window; main window frame and focus events.", component: WindowManager },
  { id: "window-options", title: "Window options", summary: "Open a child window with options applied, then change each option from the Windows epic on the live window; per-option availability and rejected requests.", component: WindowOptions },
  { id: "window-tabs", title: "Window tabs", summary: "Native macOS window tabs: a window type sharing one tabbing identifier, new tabs and the + button, select, merge, move to a new window, the tab bar, and a readout of tab groups and tab events.", component: WindowTabs },
  { id: "window-controls", title: "Window controls", summary: "Hide and show the macOS traffic lights; fullscreen state.", component: WindowControls },
]);
