import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";
import type { WorkerState } from "./devtools-demo";

// Strings for the DevTools screen. Availability, target titles and results come from the API and the development
// server (JSON, English target titles, error codes), so flows can assert them in any locale.
export type DevToolsMessages = {
  title: string;
  intro: string;
  sections: { availability: string; targets: string; tryIt: string; result: string };
  unavailable: string;
  shortcut: string;
  shared: string;
  worker(name: string): string;
  workerStatus: Record<WorkerState["status"], string>;
  open: string;
  steps: string;
  runProbe: string;
  runWorkerProbe: string;
  throwUncaught: string;
  opened: string;
  noResult: string;
};

const en: DevToolsMessages = {
  title: "React Native DevTools",
  intro: "Every JavaScript runtime is its own debug target with breakpoints, the console, sources with source maps and pause on uncaught exceptions. Sessions survive source edits and reloads.",
  sections: { availability: "Availability", targets: "Debug targets", tryIt: "Try it", result: "Last result" },
  unavailable: "DevTools needs a development build running JavaScript from the development server (spark dev). Release builds contain none of it.",
  shortcut: "⌥⌘I opens DevTools for the shared runtime.",
  shared: "Shared runtime",
  worker: name => `Worker runtime “${name}”`,
  workerStatus: { off: "Not started", starting: "Starting…", running: "Running", failed: "Failed" },
  open: "Open DevTools",
  steps: "Set a breakpoint in screens/devtools/probe.ts, then run the probe. In the console, run ksDevTools.probe(\"console\").",
  runProbe: "Run probe",
  runWorkerProbe: "Run probe in worker",
  throwUncaught: "Throw an uncaught exception",
  opened: "DevTools requested",
  noResult: "—",
};

const ar: DevToolsMessages = {
  title: "أدوات مطوّري React Native",
  intro: "كل بيئة تشغيل JavaScript هدف تصحيح مستقل، فيه نقاط التوقف ووحدة التحكم والمصادر مع خرائط المصادر والإيقاف عند الاستثناءات غير الملتقطة. تبقى الجلسات بعد تعديل المصادر وإعادة التحميل.",
  sections: { availability: "التوفر", targets: "أهداف التصحيح", tryIt: "جرّبها", result: "آخر نتيجة" },
  unavailable: "تحتاج أدوات المطوّر إلى نسخة تطوير تشغّل JavaScript من خادم التطوير (spark dev). لا تحتوي نسخ الإصدار على شيء منها.",
  shortcut: "يفتح ⌥⌘I أدوات المطوّر لبيئة التشغيل المشتركة.",
  shared: "بيئة التشغيل المشتركة",
  worker: name => `بيئة تشغيل العامل «${name}»`,
  workerStatus: { off: "لم تبدأ", starting: "جارٍ البدء…", running: "تعمل", failed: "فشلت" },
  open: "فتح أدوات المطوّر",
  steps: "ضع نقطة توقف في screens/devtools/probe.ts ثم شغّل المسبار. وفي وحدة التحكم شغّل ksDevTools.probe(\"console\").",
  runProbe: "تشغيل المسبار",
  runWorkerProbe: "تشغيل المسبار في العامل",
  throwUncaught: "رمي استثناء غير ملتقط",
  opened: "طُلب فتح أدوات المطوّر",
  noResult: "—",
};

export const DEVTOOLS_MESSAGES: Record<Locale, DevToolsMessages> = { en, ar };
export function useDevToolsMessages() { return DEVTOOLS_MESSAGES[useI18n().locale]; }
