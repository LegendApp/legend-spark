import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Clipboard data screen. Readouts (availability JSON, results, counts and pasteboard types) are data,
// so flows can assert them in any locale; they are not translated.
export type ClipboardMessages = {
  sections: { availability: string; write: string; promised: string; read: string; changes: string };
  writeHint: string;
  copyText: string;
  copyRich: string;
  copyConcealed: string;
  copyTransient: string;
  promisedHint: string;
  promise: string;
  promiseSlow: string;
  promiseFailing: string;
  provided: string;
  provideError: string;
  readHint: string;
  read: string;
  getHtml: string;
  formats: string;
  hasText: string;
  clear: string;
  changesHint: string;
  watch: string;
  unwatch: string;
  watching: string;
  events: string;
  lastChange: string;
  changeCount: string;
  unavailable: string;
  none: string;
};

const en: ClipboardMessages = {
  sections: { availability: "Availability", write: "Copy", promised: "Promised data", read: "Read", changes: "Change monitoring" },
  writeHint: "Concealed data (passwords) is not recorded by clipboard managers; transient data is ignored by them.",
  copyText: "Copy text",
  copyRich: "Copy text, HTML and RTF",
  copyConcealed: "Copy a password (concealed)",
  copyTransient: "Copy transient text",
  promisedHint: "Promised types are produced only when something pastes them, here or in another app, once per type.",
  promise: "Promise text, HTML and PNG",
  promiseSlow: "Promise text that arrives too late",
  promiseFailing: "Promise text whose provider fails",
  provided: "Provided",
  provideError: "Provider error",
  readHint: "Reading pastes every representation, so it asks for promised data.",
  read: "Read clipboard",
  getHtml: "Read text as HTML",
  formats: "List standard formats",
  hasText: "Has text",
  clear: "Clear clipboard",
  changesHint: "Polls the change count every 200 ms without reading the contents; copying anywhere counts.",
  watch: "Start watching",
  unwatch: "Stop watching",
  watching: "Watching",
  events: "Change events",
  lastChange: "Last change count",
  changeCount: "Read change count",
  unavailable: "Not available on this platform.",
  none: "—",
};
const ar: ClipboardMessages = {
  sections: { availability: "التوفر", write: "النسخ", promised: "البيانات الموعودة", read: "القراءة", changes: "مراقبة التغييرات" },
  writeHint: "لا تسجّل برامج إدارة الحافظة البيانات المخفية (كلمات المرور)، وتتجاهل البيانات المؤقتة.",
  copyText: "نسخ النص",
  copyRich: "نسخ النص وHTML وRTF",
  copyConcealed: "نسخ كلمة مرور (مخفية)",
  copyTransient: "نسخ نص مؤقت",
  promisedHint: "لا تُنتج الأنواع الموعودة إلا عند لصقها، هنا أو في تطبيق آخر، مرة واحدة لكل نوع.",
  promise: "وعد بنص وHTML وPNG",
  promiseSlow: "وعد بنص يصل متأخرًا",
  promiseFailing: "وعد بنص يفشل مزوّده",
  provided: "المُقدَّم",
  provideError: "خطأ المزوّد",
  readHint: "القراءة تلصق كل التمثيلات، لذا تطلب البيانات الموعودة.",
  read: "قراءة الحافظة",
  getHtml: "قراءة النص بتنسيق HTML",
  formats: "عرض التنسيقات القياسية",
  hasText: "هل يوجد نص",
  clear: "مسح الحافظة",
  changesHint: "يفحص عدّاد التغييرات كل 200 ملّي ثانية دون قراءة المحتوى؛ أي نسخ في أي مكان يُحتسب.",
  watch: "بدء المراقبة",
  unwatch: "إيقاف المراقبة",
  watching: "المراقبة",
  events: "أحداث التغيير",
  lastChange: "آخر عدّاد تغيير",
  changeCount: "قراءة عدّاد التغييرات",
  unavailable: "غير متاح على هذا النظام.",
  none: "—",
};

export const CLIPBOARD_MESSAGES: Record<Locale, ClipboardMessages> = { en, ar };
export function useClipboardMessages() { return CLIPBOARD_MESSAGES[useI18n().locale]; }
