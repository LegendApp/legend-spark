import type { HapticPattern } from "@legendapp/spark/pointer";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Pointer screen. Readouts (availability JSON, cursor style values, gesture values and results)
// are data, so flows can assert them in any locale; they are not translated.
export type PointerMessages = {
  sections: { availability: string; cursors: string; typing: string; canvas: string; haptics: string };
  cursorsHint: string;
  custom: string;
  customChild: string;
  typingHint: string;
  placeholder: string;
  typingField: string;
  hide: string;
  canvasHint: string;
  readouts: { scale: string; rotation: string; swipe: string; smartZooms: string; stage: string; forceClicks: string; button: string };
  reset: string;
  hapticsHint: string;
  patterns: Record<HapticPattern, string>;
  invalidPattern: string;
  unavailable: string;
  none: string;
};

const en: PointerMessages = {
  sections: { availability: "Availability", cursors: "Cursors", typing: "Hide while typing", canvas: "Trackpad and mouse", haptics: "Haptic feedback" },
  cursorsHint: "Standard cursors come from React Native's cursor style. A PointerView adds a custom cursor; a child's own cursor wins inside it.",
  custom: "Custom cursor: SF Symbol pencil.tip",
  customChild: "Child with cursor: pointer",
  typingHint: "Typing hides the cursor until the pointer moves, as in any text field. The button does the same for your own views.",
  placeholder: "Type something",
  typingField: "Typing field",
  hide: "Hide cursor until moved",
  canvasHint: "Pinch, rotate, swipe with three fingers, double-tap with two fingers, force click, or press the back and forward mouse buttons over the canvas.",
  readouts: { scale: "Scale", rotation: "Rotation (°)", swipe: "Swipe", smartZooms: "Smart zooms", stage: "Pressure stage", forceClicks: "Force clicks", button: "Mouse button" },
  reset: "Reset canvas",
  hapticsHint: "Plays on a Force Touch trackpad. Without one nothing plays, and the call still resolves.",
  patterns: { generic: "Generic", alignment: "Alignment", levelChange: "Level change" },
  invalidPattern: "Unknown pattern",
  unavailable: "Pointer features are not available on this platform.",
  none: "—",
};
const ar: PointerMessages = {
  sections: { availability: "التوفر", cursors: "المؤشرات", typing: "الإخفاء أثناء الكتابة", canvas: "لوحة التتبع والفأرة", haptics: "الاستجابة اللمسية" },
  cursorsHint: "تأتي المؤشرات القياسية من نمط cursor في React Native. يضيف PointerView مؤشرًا مخصصًا، ويتقدّم مؤشر العنصر الفرعي داخله.",
  custom: "مؤشر مخصص: رمز SF pencil.tip",
  customChild: "عنصر فرعي بالمؤشر: pointer",
  typingHint: "تُخفي الكتابة المؤشر حتى يتحرك، كما في أي حقل نص. ويفعل الزر الشيء نفسه لعناصرك.",
  placeholder: "اكتب شيئًا",
  typingField: "حقل الكتابة",
  hide: "إخفاء المؤشر حتى يتحرك",
  canvasHint: "قرّب بإصبعين أو دوّر أو اسحب بثلاثة أصابع أو انقر مرتين بإصبعين أو انقر بقوة أو اضغط زرّي الرجوع والتقدّم في الفأرة فوق اللوحة.",
  readouts: { scale: "المقياس", rotation: "الدوران (°)", swipe: "السحب", smartZooms: "التكبير الذكي", stage: "مرحلة الضغط", forceClicks: "النقرات القوية", button: "زر الفأرة" },
  reset: "إعادة تعيين اللوحة",
  hapticsHint: "تعمل على لوحة تتبع Force Touch. بدونها لا يحدث شيء، ويكتمل الاستدعاء رغم ذلك.",
  patterns: { generic: "عام", alignment: "محاذاة", levelChange: "تغيّر المستوى" },
  invalidPattern: "نمط غير معروف",
  unavailable: "ميزات المؤشر غير متاحة على هذا النظام.",
  none: "—",
};

export const POINTER_MESSAGES: Record<Locale, PointerMessages> = { en, ar };
export function usePointerMessages() { return POINTER_MESSAGES[useI18n().locale]; }
