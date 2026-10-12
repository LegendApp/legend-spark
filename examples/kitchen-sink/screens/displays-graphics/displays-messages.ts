import { useI18n } from "../../shell/app-controller";
import { MESSAGES, type Locale } from "../../shell/i18n";
import type { ShownField } from "./displays-demo";

// Strings for the Displays screen. Values are JSON from the API, so flows can assert them in any locale;
// they are not translated.
export type DisplaysMessages = {
  sections: { availability: string; displays: string; changes: string };
  fields: Record<ShownField, string>;
  primary: string;
  loading: string;
  noChanges: string;
  change(number: number): string;
  added: string;
  removed: string;
  changed: string;
};

const en: DisplaysMessages = {
  sections: { availability: "Availability", displays: "Displays", changes: "Changes" },
  fields: { persistentId: "Persistent ID", origin: "Origin", size: "Size", workArea: "Work area", scaleFactor: "Scale", safeArea: "Safe area", refreshRate: "Refresh rate (Hz)", colorSpace: "Color space", edrHeadroom: "EDR headroom" },
  primary: "Primary",
  loading: "Reading displays…",
  noChanges: "No changes since this screen opened. Connect or arrange a display, or change its resolution, refresh rate or color profile.",
  change: number => `Change ${number}`,
  added: "Added",
  removed: "Removed",
  changed: "Changed",
};

const n = MESSAGES.ar.number;
const ar: DisplaysMessages = {
  sections: { availability: "التوفر", displays: "الشاشات", changes: "التغييرات" },
  fields: { persistentId: "المعرّف الدائم", origin: "نقطة الأصل", size: "الحجم", workArea: "مساحة العمل", scaleFactor: "التكبير", safeArea: "المنطقة الآمنة", refreshRate: "معدل التحديث (هرتز)", colorSpace: "فضاء الألوان", edrHeadroom: "هامش EDR" },
  primary: "رئيسية",
  loading: "جارٍ قراءة الشاشات…",
  noChanges: "لا تغييرات منذ فتح هذه الشاشة. صِل شاشة أو رتّبها، أو غيّر دقتها أو معدل تحديثها أو ملف ألوانها.",
  change: number => `التغيير ${n(number)}`,
  added: "أُضيفت",
  removed: "أُزيلت",
  changed: "تغيّرت",
};

export const DISPLAYS_MESSAGES: Record<Locale, DisplaysMessages> = { en, ar };
export function useDisplaysMessages() { return DISPLAYS_MESSAGES[useI18n().locale]; }
