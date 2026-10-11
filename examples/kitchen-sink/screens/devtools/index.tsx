import { defineScreens } from "../../shell/registry";
import { DeveloperMenu } from "./DeveloperMenu";
import { DevTools } from "./DevTools";

export default defineScreens("devtools", [
  { id: "devtools", title: "React Native DevTools", summary: "The Hermes debugger per JavaScript runtime: breakpoints, console, sources with source maps, pause on exceptions; ⌥⌘I.", component: DevTools },
  { id: "dev-menu", title: "Developer menu", summary: "The development-only Developer menu: Reload, DevTools, Element Inspector, Performance Monitor, Fast Refresh and bundle info for the key window's runtime.", component: DeveloperMenu },
]);
