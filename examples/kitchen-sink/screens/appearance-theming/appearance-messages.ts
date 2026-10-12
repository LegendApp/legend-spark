import type { AppearancePreferences } from "@legendapp/spark/system";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";
import type { WindowAppearance } from "./useAppearancePreferences";

// Strings for the Appearance preferences screen. Values (light, dark, true, false, #rrggbb, event types and
// color names) are what the APIs report, so flows can assert them in any locale; they are not translated.
export type AppearanceMessages = {
  title: string;
  intro: string;
  sections: { availability: string; preferences: string; events: string; window: string; colors: string };
  fields: Record<keyof AppearancePreferences, string>;
  loading: string;
  subscribing: string;
  listening: string;
  noEvents: string;
  injected: string;
  windowIntro: string;
  windowOptions: Record<WindowAppearance, string>;
  windowApplied: string;
  colorsIntro: string;
  colorsUnsupported: string;
};

const en: AppearanceMessages = {
  title: "Appearance preferences",
  intro: "The user's appearance and accessibility display settings from getAppearancePreferences(), re-read whenever onSystemEvent reports a change.",
  sections: { availability: "Availability", preferences: "Preferences", events: "Events", window: "This window's appearance", colors: "Semantic system colors" },
  fields: {
    appearance: "System appearance", automaticAppearance: "Automatic (Auto)", accentColor: "Accent color", highlightColor: "Highlight color",
    increaseContrast: "Increase contrast", reduceTransparency: "Reduce transparency", reduceMotion: "Reduce motion",
    differentiateWithoutColor: "Differentiate without color", invertColors: "Invert colors", keyboardNavigation: "Keyboard navigation",
  },
  loading: "Reading preferences…",
  subscribing: "Subscribing to appearance events…",
  listening: "Listening for appearanceChanged, systemColorsChanged and accessibilityDisplayChanged.",
  noEvents: "No events since this screen opened. Change the appearance, accent or highlight color, or a display setting under Accessibility.",
  injected: "In a test-driver run, flows deliver these events and the values they imply with simulateSystemEvent instead of changing the Mac.",
  windowIntro: "setWindowOptions(windowId, { appearance }) overrides the appearance of this window only. The swatches below follow it; leaving the screen restores it.",
  windowOptions: { system: "Follow the app", light: "Light window", dark: "Dark window" },
  windowApplied: "Applied:",
  colorsIntro: "PlatformColor names from react-native-macos resolve to AppKit's semantic colors in each view's effective appearance.",
  colorsUnsupported: "Semantic color swatches are shown on macOS.",
};

const ar: AppearanceMessages = {
  title: "تفضيلات المظهر",
  intro: "إعدادات المظهر وعرض تسهيلات الاستخدام لدى المستخدم من getAppearancePreferences()، تُقرأ من جديد كلما أبلغ onSystemEvent عن تغيير.",
  sections: { availability: "التوفر", preferences: "التفضيلات", events: "الأحداث", window: "مظهر هذه النافذة", colors: "ألوان النظام الدلالية" },
  fields: {
    appearance: "مظهر النظام", automaticAppearance: "تلقائي", accentColor: "لون التمييز", highlightColor: "لون التحديد",
    increaseContrast: "زيادة التباين", reduceTransparency: "تقليل الشفافية", reduceMotion: "تقليل الحركة",
    differentiateWithoutColor: "التمييز دون لون", invertColors: "عكس الألوان", keyboardNavigation: "التنقل بلوحة المفاتيح",
  },
  loading: "جارٍ قراءة التفضيلات…",
  subscribing: "جارٍ الاشتراك في أحداث المظهر…",
  listening: "يستمع إلى appearanceChanged وsystemColorsChanged وaccessibilityDisplayChanged.",
  noEvents: "لا أحداث منذ فتح هذه الشاشة. غيّر المظهر أو لون التمييز أو التحديد، أو أحد إعدادات العرض في تسهيلات الاستخدام.",
  injected: "في تشغيل مشغّل الاختبار، توصل التدفقات هذه الأحداث والقيم التي تقتضيها عبر simulateSystemEvent بدل تغيير جهاز Mac.",
  windowIntro: "يتجاوز setWindowOptions(windowId, { appearance }) مظهر هذه النافذة وحدها. تتبعه العينات أدناه، ويعود عند مغادرة الشاشة.",
  windowOptions: { system: "اتباع التطبيق", light: "نافذة فاتحة", dark: "نافذة داكنة" },
  windowApplied: "المطبّق:",
  colorsIntro: "أسماء PlatformColor من react-native-macos تُحلّ إلى ألوان AppKit الدلالية حسب المظهر الفعلي لكل عرض.",
  colorsUnsupported: "تظهر عينات الألوان الدلالية على macOS.",
};

export const APPEARANCE_MESSAGES: Record<Locale, AppearanceMessages> = { en, ar };
export function useAppearanceMessages() { return APPEARANCE_MESSAGES[useI18n().locale]; }
