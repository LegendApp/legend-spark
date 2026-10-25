import { defineScreens } from "../../shell/registry";
import { APPEARANCE_MESSAGES } from "./appearance-messages";
import { AppearancePreferences } from "./AppearancePreferences";

export default defineScreens("appearance-theming", [
  { id: "preferences", title: "Appearance preferences", titles: { ar: APPEARANCE_MESSAGES.ar.title }, summary: "System appearance, accent and highlight colors, increase contrast, reduce transparency and motion, differentiate without color, invert colors and keyboard navigation, with their change events, a per-window appearance override and AppKit semantic colors.", summaries: { ar: "مظهر النظام، ولونا التمييز والتحديد، وزيادة التباين، وتقليل الشفافية والحركة، والتمييز دون استخدام اللون، وعكس الألوان، والتنقل بلوحة المفاتيح، مع أحداث تغيّرها، وتجاوز المظهر لكل نافذة، وألوان AppKit الدلالية." }, component: AppearancePreferences },
]);
