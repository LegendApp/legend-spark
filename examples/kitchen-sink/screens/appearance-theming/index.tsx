import { defineScreens, lazyScreen } from "../../shell/registry";
import { APPEARANCE_MESSAGES } from "./appearance-messages";
import { AppearancePreferences } from "./AppearancePreferences";

export default defineScreens("appearance-theming", [
  { id: "preferences", title: "Appearance preferences", titles: { ar: APPEARANCE_MESSAGES.ar.title }, summary: "System appearance, accent and highlight colors, increase contrast, reduce transparency and motion, differentiate without color, invert colors and keyboard navigation, with their change events, a per-window appearance override and AppKit semantic colors.", summaries: { ar: "مظهر النظام، ولونا التمييز والتحديد، وزيادة التباين، وتقليل الشفافية والحركة، والتمييز دون استخدام اللون، وعكس الألوان، والتنقل بلوحة المفاتيح، مع أحداث تغيّرها، وتجاوز المظهر لكل نافذة، وألوان AppKit الدلالية." }, component: AppearancePreferences },
  { id: "unistyles", title: "Unistyles", titles: { ar: "أنماط Unistyles" }, summary: "react-native-unistyles on desktop: adaptive light and dark themes that follow the app's appearance, breakpoints from the window width, and runtime values.", summaries: { ar: "‏react-native-unistyles على سطح المكتب: سمات فاتحة وداكنة تتبع مظهر التطبيق، ونقاط توقف حسب عرض النافذة، وقيم وقت التشغيل." }, component: lazyScreen(() => require("./unistyles/UnistylesDemo").UnistylesDemo) },
  { id: "system-ui", title: "System UI", titles: { ar: "واجهة النظام" }, summary: "expo-system-ui on desktop: setting and reading the main window's background color, then restoring the default.", summaries: { ar: "‏expo-system-ui على سطح المكتب: تعيين لون خلفية النافذة الرئيسية وقراءته ثم استعادة اللون الافتراضي." }, component: lazyScreen(() => require("./SystemUIDemo").SystemUIDemo) },
]);
