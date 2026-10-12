import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Pickers screen. Value, availability and font readouts are API data, so they are not translated.
export type PickerRow =
  | "date" | "time" | "date-time" | "text-field" | "bounded" | "calendar" | "clock" | "umm-al-qura" | "japanese"
  | "well" | "well-minimal" | "well-expanded" | "well-alpha";
type PickerMessages = {
  rows: Record<PickerRow, string>;
  sections: { dates: string; colors: string; panels: string };
  disable: string;
  zoneNote: string;
  showColorPanel: string;
  sampleColor: string;
  showFontPanel: string;
  closePanel: string;
  fontSample: string;
  noResult: string;
};

const en: PickerMessages = {
  rows: {
    date: "Date", time: "Time", "date-time": "Date and time", "text-field": "Text field (no stepper)", bounded: "March 2026 only",
    calendar: "Calendar", clock: "Clock", "umm-al-qura": "Umm al-Qura (ar-SA)", japanese: "Japanese calendar",
    well: "Color well", "well-minimal": "Minimal well", "well-expanded": "Expanded well", "well-alpha": "Well with opacity",
  },
  sections: { dates: "Date and time pickers", colors: "Color wells", panels: "System panels" },
  disable: "Disable controls",
  zoneNote: "All pickers use UTC; readouts are Unix milliseconds and ISO 8601.",
  showColorPanel: "Show color panel",
  sampleColor: "Pick a color from the screen",
  showFontPanel: "Show font panel",
  closePanel: "Close",
  fontSample: "The quick brown fox jumps over the lazy dog",
  noResult: "No result yet",
};

const ar: PickerMessages = {
  rows: {
    date: "التاريخ", time: "الوقت", "date-time": "التاريخ والوقت", "text-field": "حقل نصي (بلا عدّاد)", bounded: "مارس 2026 فقط",
    calendar: "التقويم", clock: "الساعة", "umm-al-qura": "أم القرى (ar-SA)", japanese: "التقويم الياباني",
    well: "حاوية لون", "well-minimal": "حاوية لون مصغّرة", "well-expanded": "حاوية لون موسّعة", "well-alpha": "حاوية لون بالشفافية",
  },
  sections: { dates: "منتقيات التاريخ والوقت", colors: "حاويات الألوان", panels: "لوحات النظام" },
  disable: "تعطيل عناصر التحكم",
  zoneNote: "تستخدم كل المنتقيات التوقيت العالمي؛ القراءات بالمللي ثانية منذ 1970 وبصيغة ISO 8601.",
  showColorPanel: "إظهار لوحة الألوان",
  sampleColor: "التقاط لون من الشاشة",
  showFontPanel: "إظهار لوحة الخطوط",
  closePanel: "إغلاق",
  fontSample: "نص تجريبي بالخط المختار",
  noResult: "لا توجد نتيجة بعد",
};

export const PICKER_MESSAGES: Record<Locale, PickerMessages> = { en, ar };
export function usePickerMessages() { return PICKER_MESSAGES[useI18n().locale]; }
