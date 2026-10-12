import { useI18n } from "../../shell/app-controller";
import { MESSAGES, type Locale } from "../../shell/i18n";

// Strings for the Window performance screen. Flows assert testIDs, which carry the values in every locale.
export type PerformanceMessages = {
  title: string;
  availability: string;
  features: { pool: string; throttle: string };
  pooled: string; tight: string; clock: string; warmPaint: string; coldPaint: string; hiddenRenders: string;
  pool(state: { warm: number; target: number; hits: number; misses: number; released: number; measuredWindowMB: number | null; memoryBudgetMB: number; memoryPressure: boolean }): string;
  paint(ms: number): string;
  clockState(value: number, renders: number, shown: boolean): string;
  none: string;
  run(runs: number, steps: number): string;
  note: string;
  buttons: Record<"prewarm" | "warm" | "cold" | "close" | "trim" | "tight" | "clock" | "clock-hide" | "clock-tick" | "clock-show" | "close-all", string>;
};

const en: PerformanceMessages = {
  title: "Window performance",
  availability: "Availability",
  features: { pool: "Window pools", throttle: "Background render throttling" },
  pooled: "Pooled note", tight: "1 MB budget", clock: "Throttled clock", warmPaint: "Warm open", coldPaint: "Cold open", hiddenRenders: "Renders while hidden",
  pool: ({ warm, target, hits, misses, released, measuredWindowMB, memoryBudgetMB, memoryPressure }) =>
    `${warm} warm of ${target} · ${hits} hits · ${misses} misses · ${released} released · ${measuredWindowMB ?? "?"} MB per window of ${memoryBudgetMB} MB${memoryPressure ? " · memory pressure" : ""}`,
  paint: ms => `${ms} ms to first paint`,
  clockState: (value, renders, shown) => `value ${value} · ${renders} renders · ${shown ? "shown" : "hidden"}`,
  none: "—",
  run: (runs, steps) => `Run ${runs}: ${steps} steps`,
  note: "Driven runs never show these windows; times run from the open call to the content's first commit with the window shown.",
  buttons: { prewarm: "Prewarm", warm: "Open pooled note", cold: "Open cold note", close: "Close last note", trim: "Trim pools", tight: "Prewarm 1 MB pool",
    clock: "Open throttled clock", "clock-hide": "Hide clock", "clock-tick": "Advance clock 5 times", "clock-show": "Show clock", "close-all": "Close all" },
};

const n = MESSAGES.ar.number;
const ar: PerformanceMessages = {
  title: "أداء النوافذ",
  availability: "التوفر",
  features: { pool: "مجمّعات النوافذ", throttle: "إبطاء العرض في الخلفية" },
  pooled: "ملاحظة من المجمّع", tight: "ميزانية ١ ميغابايت", clock: "ساعة مُبطّأة", warmPaint: "فتح جاهز", coldPaint: "فتح بارد", hiddenRenders: "مرات العرض أثناء الإخفاء",
  pool: ({ warm, target, hits, misses, released, measuredWindowMB, memoryBudgetMB, memoryPressure }) =>
    `${n(warm)} جاهزة من ${n(target)} · ${n(hits)} إصابة · ${n(misses)} إخفاق · ${n(released)} مُحرَّرة · ${measuredWindowMB === null ? "؟" : n(measuredWindowMB)} ميغابايت لكل نافذة من ${n(memoryBudgetMB)} ميغابايت${memoryPressure ? " · ضغط على الذاكرة" : ""}`,
  paint: ms => `${n(ms)} ملّي ثانية حتى أول رسم`,
  clockState: (value, renders, shown) => `القيمة ${n(value)} · ${n(renders)} مرة عرض · ${shown ? "ظاهرة" : "مخفية"}`,
  none: "—",
  run: (runs, steps) => `التشغيل ${n(runs)}: ${n(steps)} خطوات`,
  note: "التشغيل الآلي لا يُظهر هذه النوافذ أبدًا؛ تُقاس الأزمنة من استدعاء الفتح حتى أول تثبيت للمحتوى والنافذة ظاهرة.",
  buttons: { prewarm: "تجهيز مسبق", warm: "فتح ملاحظة من المجمّع", cold: "فتح ملاحظة باردة", close: "إغلاق آخر ملاحظة", trim: "تفريغ المجمّعات", tight: "تجهيز مجمّع ١ ميغابايت",
    clock: "فتح الساعة المُبطّأة", "clock-hide": "إخفاء الساعة", "clock-tick": "تقديم الساعة ٥ مرات", "clock-show": "إظهار الساعة", "close-all": "إغلاق الكل" },
};

export const PERFORMANCE_MESSAGES: Record<Locale, PerformanceMessages> = { en, ar };
export function usePerformanceMessages() { return PERFORMANCE_MESSAGES[useI18n().locale]; }
