import { defineScreens } from "../../shell/registry";
import { DockTaskbar } from "./DockTaskbar";
import { Permissions } from "./Permissions";
import { SystemState } from "./SystemState";

export default defineScreens("system-integration", [
  { id: "dock", title: "Dock & taskbar", summary: "App badge text and counts, Dock tile and taskbar progress (normal, paused, error, indeterminate), attention requests, and the Dock menu or Jump List with recent items.", component: DockTaskbar },
  { id: "state", title: "System state", summary: "System information (Rosetta, time zone, Low Power Mode, thermal state, idle time, battery), the network path and proxies, and live sleep, lock, session, power, thermal, network, locale, clock and memory pressure events.", component: SystemState },
  { id: "permissions", title: "Privacy permissions", summary: "Status, requests and change events for camera, microphone, screen recording, accessibility, input monitoring, automation, contacts, calendar, photos and location, and links to their System Settings panes.", component: Permissions },
]);
