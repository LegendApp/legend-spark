import { defineScreens } from "../../shell/registry";
import { Multiwindow } from "./Multiwindow";
import { SpecialWindows } from "./SpecialWindows";

export default defineScreens("multiwindow", [
  { id: "windows", title: "Multiwindow", summary: "Window types, a single Settings window, a document shared live across windows, per-window state with promotion, and per-window error isolation.", component: Multiwindow },
  { id: "special-windows", title: "Special windows", summary: "A Spotlight-style command bar on a global hotkey, a HUD, a Quick Look-style preview, picture in picture with corner snapping, notch and menu bar popovers, an edge drawer, a click-through overlay, a desktop widget and presenter mode, with each window's state and bounds.", component: SpecialWindows },
]);
