import { defineScreens } from "../../shell/registry";
import { DeveloperMenu } from "./DeveloperMenu";
import { DevTools } from "./DevTools";
import { Network } from "./Network";

export default defineScreens("devtools", [
  { id: "devtools", title: "React Native DevTools", summary: "The Hermes debugger per JavaScript runtime: breakpoints, console, sources with source maps, pause on exceptions; ⌥⌘I.", component: DevTools },
  { id: "network", title: "Network inspector", summary: "fetch, XMLHttpRequest and WebSocket traffic in React Native DevTools' Network panel, with redacted headers and size-capped bodies (development builds).", component: Network },
  { id: "dev-menu", title: "Developer menu", summary: "The development-only Developer menu: Reload, DevTools, Element Inspector, Performance Monitor, Fast Refresh and bundle info for the key window's runtime.", component: DeveloperMenu },
]);
