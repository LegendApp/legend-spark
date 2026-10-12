import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";
import type { WorkerState } from "./devtools-demo";
import type { Recording } from "./profiling-demo";

// Strings for DevTools › Profiling. Availability and results come from the API (JSON, file paths, counts), so flows can
// assert them in any locale.
export type ProfilingMessages = {
  title: string;
  intro: string;
  sections: { availability: string; record: string; workloads: string; heap: string; result: string };
  unavailable: string;
  available: string;
  recording: Record<Recording, string>;
  start: string;
  stop: string;
  recordHint: string;
  workload: string;
  workerWorkload: string;
  worker: Record<WorkerState["status"], string>;
  animate: string;
  heap: string;
  allocate: string;
  noResult: string;
};

const en: ProfilingMessages = {
  title: "Profiling",
  intro: "Development builds profile JavaScript with Hermes's sampling profiler and record a frame timeline of the main thread and MotionView animations. React Native DevTools profiles and takes heap snapshots of the runtime it is attached to.",
  sections: { availability: "Availability", record: "Record a profile", workloads: "Something to profile", heap: "Heap snapshots", result: "Last result" },
  unavailable: "Profiling needs a development build (spark dev). Release builds contain none of it.",
  available: "Developer › Start Profiling and Stop Profiling… do the same from the menu bar.",
  recording: { idle: "Not recording", recording: "Recording every JavaScript runtime", saved: "Saved", failed: "Failed" },
  start: "Start profiling",
  stop: "Stop and save",
  recordHint: "Stop saves a Chrome trace (open it in Chrome DevTools' Performance panel or ui.perfetto.dev) and a source-mapped .cpuprofile per runtime in a new temporary folder.",
  workload: "Run JavaScript for 300 ms",
  workerWorkload: "Run JavaScript in the worker",
  worker: { off: "Worker not started", starting: "Worker starting…", running: "Worker running", failed: "Worker failed" },
  animate: "Slide the box",
  heap: "Press ⌥⌘I and open the Memory panel: heap snapshots, allocation timelines and allocation sampling of the runtime DevTools is attached to. Allocate puts ks-heap-shared:button in this runtime's heap.",
  allocate: "Allocate",
  noResult: "—",
};

const ar: ProfilingMessages = {
  title: "تحليل الأداء",
  intro: "تحلّل نسخ التطوير أداء JavaScript بمحلّل العيّنات في Hermes، وتسجّل خطًا زمنيًا لإطارات الخيط الرئيسي وحركات MotionView. وتحلّل أدوات React Native للمطوّر أداء بيئة التشغيل المتصلة بها وتلتقط لقطات لذاكرتها.",
  sections: { availability: "التوفر", record: "تسجيل تحليل", workloads: "ما يمكن تحليله", heap: "لقطات الذاكرة", result: "آخر نتيجة" },
  unavailable: "يحتاج تحليل الأداء إلى نسخة تطوير (spark dev). لا تحتوي نسخ الإصدار على شيء منه.",
  available: "يفعل «المطوّر › بدء تحليل الأداء» و«إيقاف تحليل الأداء…» الشيء نفسه من شريط القوائم.",
  recording: { idle: "لا تسجيل", recording: "يسجّل كل بيئات تشغيل JavaScript", saved: "حُفظ", failed: "فشل" },
  start: "بدء التحليل",
  stop: "إيقاف وحفظ",
  recordHint: "يحفظ الإيقاف ملف تتبّع Chrome (افتحه في لوحة Performance في أدوات Chrome للمطوّر أو في ui.perfetto.dev) وملف ‎.cpuprofile مربوطًا بالمصادر لكل بيئة تشغيل في مجلد مؤقت جديد.",
  workload: "تشغيل JavaScript لمدة 300 مللي ثانية",
  workerWorkload: "تشغيل JavaScript في العامل",
  worker: { off: "العامل لم يبدأ", starting: "العامل يبدأ…", running: "العامل يعمل", failed: "فشل العامل" },
  animate: "تحريك المربع",
  heap: "اضغط ⌥⌘I وافتح لوحة Memory: لقطات الذاكرة والخطوط الزمنية للتخصيص وأخذ عيّنات التخصيص لبيئة التشغيل المتصلة بها أدوات المطوّر. يضع «تخصيص» ks-heap-shared:button في ذاكرة بيئة التشغيل هذه.",
  allocate: "تخصيص",
  noResult: "—",
};

export const PROFILING_MESSAGES: Record<Locale, ProfilingMessages> = { en, ar };
export function useProfilingMessages() { return PROFILING_MESSAGES[useI18n().locale]; }
