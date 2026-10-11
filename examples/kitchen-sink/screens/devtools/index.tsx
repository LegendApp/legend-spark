import { defineScreens } from "../../shell/registry";
import { DeveloperMenu } from "./DeveloperMenu";

export default defineScreens("devtools", [
  { id: "dev-menu", title: "Developer menu", summary: "The development-only Developer menu: Reload, DevTools, Element Inspector, Performance Monitor, Fast Refresh and bundle info for the key window's runtime.", component: DeveloperMenu },
]);
