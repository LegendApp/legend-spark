import { defineScreens } from "../../shell/registry";
import { DockTaskbar } from "./DockTaskbar";

export default defineScreens("system-integration", [
  { id: "dock", title: "Dock & taskbar", summary: "App badge text and counts, Dock tile and taskbar progress (normal, paused, error, indeterminate), attention requests, the Dock menu or Jump List with recent items, and the Windows thumbnail toolbar.", component: DockTaskbar },
]);
