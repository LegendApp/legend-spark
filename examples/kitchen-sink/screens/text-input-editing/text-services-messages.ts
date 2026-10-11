import type { WritingToolsBehavior } from "@legendapp/spark/ui/text-services";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Text services screen. Availability and find results are JSON from the API, so flows can
// assert them in any locale. The sample document stays English in every locale: Match case needs a cased script.
export type TextServicesMessages = {
  intro: string;
  sections: { availability: string; services: string; writingTools: string; find: string };
  document: string;
  sparkInput: string;
  servicesHint: string;
  lookUp: string;
  writingToolsHint: string;
  behaviors: Record<WritingToolsBehavior, string>;
  findHint: string;
  query: string;
  matchCase: string;
  wrap: string;
  next: string;
  previous: string;
  showFindBar: string;
  /** The last operation's outcome: `ok`, JSON or an error code. */
  result(value: string): string;
};

const en: TextServicesMessages = {
  intro: "AppKit text services in React Native and Spark text inputs: the Services menu and Look Up on a selection, Writing Tools per input, and the native find bar with a programmatic find API.",
  sections: { availability: "Availability", services: "Services and Look Up", writingTools: "Writing Tools", find: "Find" },
  document: "Note",
  sparkInput: "Spark text input",
  servicesHint: "Select text in either input, then Control-click it for Services and Look Up, or force click a word.",
  lookUp: "Look up the note's selection",
  writingToolsHint: "Each input sets writingToolsBehavior. Writing Tools appears in the Edit menu and the context menu where the system offers it.",
  behaviors: { default: "Default", complete: "Complete (inline)", limited: "Limited (panel)", none: "None (opted out)" },
  findHint: "With the note focused, Edit > Find (⌘F) shows the find bar. The buttons below search the note with findText.",
  query: "Find in note",
  matchCase: "Match case",
  wrap: "Wrap around",
  next: "Find next",
  previous: "Find previous",
  showFindBar: "Show the find bar",
  result: value => `Result: ${value}`,
};

const ar: TextServicesMessages = {
  intro: "خدمات النص في AppKit داخل حقول إدخال React Native وSpark: قائمة الخدمات والبحث عن التعريف للنص المحدد، وأدوات الكتابة لكل حقل، وشريط البحث الأصلي مع واجهة بحث برمجية.",
  sections: { availability: "التوفر", services: "الخدمات والبحث عن التعريف", writingTools: "أدوات الكتابة", find: "البحث" },
  document: "ملاحظة",
  sparkInput: "حقل إدخال Spark",
  servicesHint: "حدّد نصًا في أي من الحقلين، ثم انقر عليه مع الضغط على Control للوصول إلى الخدمات والبحث عن التعريف، أو اضغط بقوة على كلمة.",
  lookUp: "ابحث عن تعريف النص المحدد في الملاحظة",
  writingToolsHint: "يضبط كل حقل writingToolsBehavior. تظهر أدوات الكتابة في قائمة التحرير والقائمة السياقية حيث يوفرها النظام.",
  behaviors: { default: "افتراضي", complete: "كامل (داخل النص)", limited: "محدود (لوحة)", none: "بلا (إلغاء الاشتراك)" },
  findHint: "عند التركيز على الملاحظة، يعرض التحرير > بحث (⌘F) شريط البحث. تبحث الأزرار أدناه في الملاحظة باستخدام findText.",
  query: "ابحث في الملاحظة",
  matchCase: "مطابقة حالة الأحرف",
  wrap: "الالتفاف إلى البداية",
  next: "البحث عن التالي",
  previous: "البحث عن السابق",
  showFindBar: "إظهار شريط البحث",
  result: value => `النتيجة: ${value}`,
};

export const TEXT_SERVICES_MESSAGES: Record<Locale, TextServicesMessages> = { en, ar };
export function useTextServicesMessages() { return TEXT_SERVICES_MESSAGES[useI18n().locale]; }
