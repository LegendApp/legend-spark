import { defineScreens } from "../../shell/registry";
import { Keyboard } from "./Keyboard";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("keyboard", [
  { id: "keyboard", title: "Keyboard monitor", summary: "Key down/up events for the focused window, including natively consumed keys.", component: Keyboard },
]);
