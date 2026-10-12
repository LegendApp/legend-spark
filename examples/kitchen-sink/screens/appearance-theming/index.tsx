import { defineScreens } from "../../shell/registry";
import { AppearancePreferences } from "./AppearancePreferences";
import { AppIcon } from "./AppIcon";

export default defineScreens("appearance-theming", [
  { id: "preferences", title: "Appearance preferences", summary: "System appearance, accent and highlight colors, increase contrast, reduce transparency and motion, differentiate without color, invert colors and keyboard navigation, with their change events, a per-window appearance override and AppKit semantic colors.", component: AppearancePreferences },
  { id: "app-icon", title: "App icon", summary: "The app's icon as Finder and the Dock draw it, from 16 to 512 pixels, in the default, dark, clear and tinted styles of macOS 26.", component: AppIcon },
]);
