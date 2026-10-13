import { defineScreens } from "../../shell/registry";
import { APP_ICON_MESSAGES } from "./app-icon-messages";
import { APPEARANCE_MESSAGES } from "./appearance-messages";
import { AppearancePreferences } from "./AppearancePreferences";
import { AppIcon } from "./AppIcon";

export default defineScreens("appearance-theming", [
  { id: "preferences", title: "Appearance preferences", titles: { ar: APPEARANCE_MESSAGES.ar.title }, summary: "System appearance, accent and highlight colors, increase contrast, reduce transparency and motion, differentiate without color, invert colors and keyboard navigation, with their change events, a per-window appearance override and AppKit semantic colors.", summaries: { ar: "مظهر النظام، ولونا التمييز والتحديد، وزيادة التباين، وتقليل الشفافية والحركة، والتمييز دون استخدام اللون، وعكس الألوان، والتنقل بلوحة المفاتيح، مع أحداث تغيّرها، وتجاوز المظهر لكل نافذة، وألوان AppKit الدلالية." }, component: AppearancePreferences },
  { id: "app-icon", title: "App icon", titles: { ar: APP_ICON_MESSAGES.ar.title }, summary: "The app's icon as Finder and the Dock draw it, from 16 to 512 pixels, in the default, dark, clear and tinted styles of macOS 26.", summaries: { ar: "أيقونة التطبيق كما يرسمها Finder وDock، من 16 إلى 512 بكسل، بالأنماط الافتراضي والداكن والشفاف والملوّن في macOS 26." }, component: AppIcon },
]);
