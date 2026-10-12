import { defineScreens } from "../../shell/registry";
import { DeveloperMenu } from "./DeveloperMenu";
import { DevTools } from "./DevTools";
import { Network } from "./Network";
import { Profiling } from "./Profiling";
import { PROFILING_MESSAGES } from "./profiling-messages";

export default defineScreens("devtools", [
  { id: "devtools", title: "React Native DevTools", summary: "The Hermes debugger per JavaScript runtime: breakpoints, console, sources with source maps, pause on exceptions; ⌥⌘I.", component: DevTools },
  { id: "network", title: "Network inspector", summary: "fetch, XMLHttpRequest and WebSocket traffic in React Native DevTools' Network panel, with redacted headers and size-capped bodies (development builds).", component: Network },
  { id: "profiling", title: "Profiling", titles: { ar: PROFILING_MESSAGES.ar.title }, summary: "Hermes sampling profiles of every JavaScript runtime, source-mapped, and a frame timeline of main-thread frames and motion as a Chrome trace; heap snapshots in DevTools (development builds).", component: Profiling },
  { id: "dev-menu", title: "Developer menu", summary: "The development-only Developer menu: Reload, DevTools, Element Inspector, Performance Monitor, Fast Refresh and bundle info for the key window's runtime.", component: DeveloperMenu },
]);
