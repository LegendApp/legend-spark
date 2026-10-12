import type { SimulatedCrashKind } from "@legendapp/spark/diagnostics";
import { useI18n } from "../../shell/app-controller";
import { MESSAGES, type Locale } from "../../shell/i18n";

// Strings for the Crash reporting screen. Availability, state, checks and report contents are API values
// or JSON, so flows can assert them in any locale; they are not translated.
export type CrashReportingMessages = {
  sections: { consent: string; simulate: string; reports: string };
  intro: string;
  grant: string;
  revoke: string;
  simulateHint: string;
  kind: Record<SimulatedCrashKind, string>;
  crashing: string;
  deleteAll: string;
  count(count: number): string;
  none: string;
  simulatedTag: string;
};

const en: CrashReportingMessages = {
  sections: { consent: "Consent", simulate: "Simulate a crash", reports: "Crash reports on this Mac" },
  intro: "With consent, signals and uncaught exceptions are written to disk by the crashing process and symbolicated at the next launch; fatal JavaScript errors are written before React Native handles them. Reports stay on this Mac.",
  grant: "Allow crash reporting",
  revoke: "Turn crash reporting off",
  simulateHint: "Native crashes happen in a helper process started from this app, so the app keeps running. The JavaScript crash is a real TypeError, recorded and not passed on.",
  kind: { badAccess: "Bad memory access", abort: "abort()", uncaughtException: "Uncaught NSException", trap: "Trap instruction", stackOverflow: "Stack overflow", javascript: "JavaScript TypeError" },
  crashing: "Crashing…",
  deleteAll: "Delete all reports",
  count: count => count === 1 ? "1 report" : `${count} reports`,
  none: "No crash reports.",
  simulatedTag: "simulated",
};

const n = MESSAGES.ar.number;
const ar: CrashReportingMessages = {
  sections: { consent: "الموافقة", simulate: "محاكاة انهيار", reports: "تقارير الانهيار على هذا الـMac" },
  intro: "بعد الموافقة، تكتب العملية المنهارة الإشارات والاستثناءات غير الملتقطة على القرص، وتُترجم رموزها عند التشغيل التالي؛ وتُكتب أخطاء JavaScript القاتلة قبل أن يعالجها React Native. تبقى التقارير على هذا الجهاز.",
  grant: "السماح بتقارير الانهيار",
  revoke: "إيقاف تقارير الانهيار",
  simulateHint: "تحدث الانهيارات الأصلية في عملية مساعدة يبدؤها هذا التطبيق، فيستمر التطبيق في العمل. انهيار JavaScript خطأ TypeError حقيقي يُسجَّل ولا يُمرَّر.",
  kind: { badAccess: "وصول خاطئ إلى الذاكرة", abort: "abort()‎", uncaughtException: "استثناء NSException غير ملتقط", trap: "تعليمة trap", stackOverflow: "فيض المكدّس", javascript: "خطأ TypeError في JavaScript" },
  crashing: "جارٍ الانهيار…",
  deleteAll: "حذف كل التقارير",
  count: count => count === 1 ? "تقرير واحد" : `${n(count)} تقارير`,
  none: "لا توجد تقارير انهيار.",
  simulatedTag: "محاكاة",
};

export const CRASH_REPORTING_MESSAGES: Record<Locale, CrashReportingMessages> = { en, ar };
export function useCrashReportingMessages() { return CRASH_REPORTING_MESSAGES[useI18n().locale]; }
