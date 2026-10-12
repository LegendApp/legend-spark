import { defineScreens } from "../../shell/registry";
import { AppearancePreferences } from "./AppearancePreferences";

export default defineScreens("appearance-theming", [
  { id: "preferences", title: "Appearance preferences", summary: "System appearance, accent and highlight colors, increase contrast, reduce transparency and motion, differentiate without color, invert colors and keyboard navigation, with their change events, a per-window appearance override and AppKit semantic colors.", component: AppearancePreferences },
]);
