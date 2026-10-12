import type { DeveloperMenuState } from "@legendapp/spark/menus";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

export type DeveloperMenuMessages = {
  title: string;
  intro: string;
  status(state: DeveloperMenuState): string;
  items: { title: string; rows: readonly (readonly [name: string, description: string])[] };
  targeting: string;
};

const en: DeveloperMenuMessages = {
  title: "Developer menu",
  intro: "Development builds add a Developer menu to the menu bar, before Window. Control-Command-Z opens it where the pointer is. Release builds contain none of it.",
  status: state => state.status === "ready" ? (state.shortcut ? `Installed. Shortcut: ${state.shortcut}` : `Installed without a shortcut: ${state.shortcutConflict?.shortcut} belongs to ${state.shortcutConflict?.description}`)
    : state.status === "installing" ? "Installing…"
    : state.status === "error" ? "The Developer menu failed to install."
    : state.reason === "release-build" ? "Not available: this JavaScript bundle is a release build."
    : state.reason === "not-installed" ? "Not installed: the app entry does not require @legendapp/spark/runtime-entry."
    : "Not available on this platform.",
  items: { title: "Items", rows: [
    ["Reload", "Reloads the JavaScript. Every runtime restarts, isolated ones included."],
    ["Open DevTools", "React Native DevTools for the key window's runtime. Disabled, with a tooltip, until DevTools support is in the build."],
    ["Toggle Element Inspector", "Inspects the elements of the key window's runtime."],
    ["Toggle Performance Monitor", "Frame rates and memory for the key window's runtime."],
    ["Fast Refresh", "Checked when Fast Refresh is on for the key window's runtime."],
    ["Start Profiling", "Samples every JavaScript runtime and records the frame timeline, whatever window is key."],
    ["Stop Profiling…", "Asks for a folder and saves a Chrome trace and a source-mapped .cpuprofile per runtime there."],
    ["Show Bundle Info", "Bundle URL, runtime, mode, JavaScript engine, React Native and Spark versions."],
  ] },
  targeting: "Items other than Reload and profiling act on the key window: its shared runtime, or the isolated runtime of an isolated window. They are disabled while no window with a React Native surface is key.",
};

const ar: DeveloperMenuMessages = {
  title: "قائمة المطوّر",
  intro: "تضيف إصدارات التطوير قائمة «المطوّر» إلى شريط القوائم قبل قائمة «نافذة». يفتحها Control-Command-Z عند موضع المؤشر. لا تحتوي إصدارات النشر على شيء منها.",
  status: state => state.status === "ready" ? (state.shortcut ? `مثبّتة. الاختصار: ${state.shortcut}` : `مثبّتة بلا اختصار: ${state.shortcutConflict?.shortcut} محجوز لـ ${state.shortcutConflict?.description}`)
    : state.status === "installing" ? "جارٍ التثبيت…"
    : state.status === "error" ? "تعذّر تثبيت قائمة المطوّر."
    : state.reason === "release-build" ? "غير متاحة: حزمة JavaScript هذه إصدار نشر."
    : state.reason === "not-installed" ? "غير مثبّتة: مدخل التطبيق لا يستورد ‎@legendapp/spark/runtime-entry."
    : "غير متاحة على هذه المنصة.",
  items: { title: "العناصر", rows: [
    ["إعادة التحميل", "يعيد تحميل JavaScript. تُعاد كل بيئات التشغيل، بما فيها المعزولة."],
    ["فتح أدوات المطوّر", "أدوات React Native للمطوّر لبيئة تشغيل النافذة النشطة. معطّل مع تلميح إلى أن يتضمن الإصدار دعمها."],
    ["تبديل فاحص العناصر", "يفحص عناصر بيئة تشغيل النافذة النشطة."],
    ["تبديل مراقب الأداء", "معدّل الإطارات والذاكرة لبيئة تشغيل النافذة النشطة."],
    ["التحديث السريع", "محدَّد عندما يكون التحديث السريع مفعّلًا لبيئة تشغيل النافذة النشطة."],
    ["بدء تحليل الأداء", "يأخذ عيّنات من كل بيئات تشغيل JavaScript ويسجّل الخط الزمني للإطارات، أيًّا كانت النافذة النشطة."],
    ["إيقاف تحليل الأداء…", "يطلب مجلدًا ويحفظ فيه ملف تتبّع Chrome وملف ‎.cpuprofile مربوطًا بالمصادر لكل بيئة تشغيل."],
    ["عرض معلومات الحزمة", "عنوان الحزمة وبيئة التشغيل والوضع ومحرّك JavaScript وإصدارا React Native وSpark."],
  ] },
  targeting: "تعمل العناصر عدا «إعادة التحميل» وتحليل الأداء على النافذة النشطة: بيئة تشغيلها المشتركة، أو بيئة التشغيل المعزولة لنافذة معزولة. وتكون معطّلة ما دامت لا توجد نافذة نشطة فيها واجهة React Native.",
};

const MESSAGES: Record<Locale, DeveloperMenuMessages> = { en, ar };
export function useDeveloperMenuMessages(): DeveloperMenuMessages { return MESSAGES[useI18n().locale]; }
