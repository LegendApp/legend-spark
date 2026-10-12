import { defineScreens } from "../../shell/registry";
import { Pointer } from "./Pointer";

export default defineScreens("pointer-trackpad", [
  { id: "pointer", title: "Pointer", summary: "Cursors, hiding the cursor while typing, trackpad gestures, Force Touch pressure, back and forward buttons, and haptic feedback.", component: Pointer },
]);
