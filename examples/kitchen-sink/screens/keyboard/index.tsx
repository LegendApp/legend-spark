import { defineScreens } from "../../shell/registry";
import { Keyboard } from "./Keyboard";
import { ShortcutMap } from "./ShortcutMap";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("keyboard", [
  { id: "keyboard", title: "Keyboard monitor", summary: "Key down/up events for the focused window, including natively consumed keys.", component: Keyboard },
  { id: "shortcut-map", title: "Shortcut map", summary: "User-editable command shortcuts: rebind, unbind and reset with persistence, live and menu updates, and conflicts across scopes.", component: ShortcutMap },
]);
