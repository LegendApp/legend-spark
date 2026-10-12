import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for DevTools › React DevTools. Availability and window IDs come from the API, so flows can assert them in
// any locale.
export type ReactDevToolsMessages = {
  title: string;
  intro: string;
  sections: { availability: string; sample: string; panels: string; windows: string; result: string };
  unavailable: string;
  shortcut: string;
  sampleLabel: string;
  count(count: number): string;
  increment: string;
  panels: string;
  open: string;
  windows: string;
  openNote: string;
  openIsolated: string;
  opened: string;
  noResult: string;
};

const en: ReactDevToolsMessages = {
  title: "React DevTools",
  intro: "React Native DevTools' Components and Profiler panels inspect each JavaScript runtime's React roots: the component tree, props, state and hooks (editable), highlight updates, and commit timings.",
  sections: { availability: "Availability", sample: "Inspect this component", panels: "Try it", windows: "More roots", result: "Last result" },
  unavailable: "React DevTools needs a development build running JavaScript from the development server (spark dev). Release builds contain none of it.",
  shortcut: "⌥⌘I opens DevTools for the shared runtime; choose Components or Profiler.",
  sampleLabel: "Sample label",
  count: count => `Count: ${count}`,
  increment: "Increment",
  panels: "In Components, select ReactDevToolsSample to read and edit its label prop and count state, or press Select element and click a view in any window. Turn on Highlight updates in Components settings, then press Increment. In Profiler, record while you press Increment to see each commit's duration.",
  open: "Open DevTools",
  windows: "Each window is its own React root in the shared runtime. An isolated-runtime window is its runtime's only root, in its own debug target.",
  openNote: "Open a note window",
  openIsolated: "Open an isolated-runtime window",
  opened: "DevTools requested",
  noResult: "—",
};

const ar: ReactDevToolsMessages = {
  title: "أدوات مطوّري React",
  intro: "تفحص لوحتا Components وProfiler في أدوات مطوّري React Native جذور React في كل بيئة تشغيل JavaScript: شجرة المكوّنات والخصائص والحالة والخطافات (مع إمكانية تعديلها)، وإبراز التحديثات، وتوقيت كل إيداع.",
  sections: { availability: "التوفر", sample: "افحص هذا المكوّن", panels: "جرّبها", windows: "جذور أخرى", result: "آخر نتيجة" },
  unavailable: "تحتاج أدوات مطوّري React إلى نسخة تطوير تشغّل JavaScript من خادم التطوير (spark dev). لا تحتوي نسخ الإصدار على شيء منها.",
  shortcut: "يفتح ⌥⌘I أدوات المطوّر لبيئة التشغيل المشتركة؛ اختر Components أو Profiler.",
  sampleLabel: "تسمية تجريبية",
  count: count => `العدد: ${count}`,
  increment: "زيادة",
  panels: "في Components اختر ReactDevToolsSample لقراءة الخاصية label والحالة count وتعديلهما، أو اضغط Select element ثم انقر عرضًا في أي نافذة. فعّل Highlight updates من إعدادات Components ثم اضغط زيادة. وفي Profiler سجّل أثناء الضغط على زيادة لترى مدة كل إيداع.",
  open: "فتح أدوات المطوّر",
  windows: "كل نافذة جذر React مستقل في بيئة التشغيل المشتركة. أما نافذة بيئة التشغيل المعزولة فهي الجذر الوحيد لبيئتها، في هدف تصحيح خاص بها.",
  openNote: "فتح نافذة ملاحظة",
  openIsolated: "فتح نافذة بيئة تشغيل معزولة",
  opened: "طُلب فتح أدوات المطوّر",
  noResult: "—",
};

export const REACT_DEVTOOLS_MESSAGES: Record<Locale, ReactDevToolsMessages> = { en, ar };
export function useReactDevToolsMessages() { return REACT_DEVTOOLS_MESSAGES[useI18n().locale]; }
