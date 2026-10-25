import type { AreaId } from "./areas";
import type { InvalidReason } from "./routes";

// Shell and app-wide strings (native menu and prompts included). Screen titles, summaries and
// screen content belong to each area. Locales without a catalog use English.
export type ThemeChoice = "system" | "light" | "dark";
export type Messages = {
  appTitle: string;
  subtitle(mode: string | undefined, projectId: string | undefined): string;
  allScreens: string;
  screens(count: number): string;
  navLabel(title: string, count: number): string;
  home(populated: number, total: number): string;
  areaChecks(prefix: string, area: string, url: string): string;
  areaEmpty(area: string): string;
  notFound: string;
  reasons: Record<InvalidReason, string>;
  unknownArea(area: string): string;
  unknownScreen(areaTitle: string, screen: string): string;
  setupFailed(message: string): string;
  theme(current: ThemeChoice, next: ThemeChoice): string;
  documentMenu: string;
  openItem: string;
  saveItem: string;
  openDialogTitle: string;
  untitledName: string;
  unsavedTitle: string;
  unsavedMessage: string;
  keepEditing: string;
  discard: string;
  number(value: number): string;
  areas: Record<AreaId, string>;
};

const SCHEME_HINT = "spark-ks://<area>/<screen>";
const arabicDigits = (value: number) => String(value).replace(/\d/g, digit => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!);
const enThemes: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };
const arThemes: Record<ThemeChoice, string> = { system: "النظام", light: "فاتح", dark: "داكن" };

const en: Messages = {
  appTitle: "Kitchen Sink",
  subtitle: (mode, projectId) => `${mode ?? "unknown"} · ${projectId ?? "no project"}`,
  allScreens: "All screens",
  screens: count => `${count} ${count === 1 ? "screen" : "screens"}`,
  navLabel: (title, count) => `${title}, ${en.screens(count)}`,
  home: (populated, total) => `${populated} of ${total} areas have screens. Every screen opens from ${SCHEME_HINT}.`,
  areaChecks: (prefix, area, url) => `Checks ${prefix}-… · e2e/checks/${area}.yaml · ${url}`,
  areaEmpty: area => `No screens registered yet. Add them in screens/${area}/index.tsx.`,
  notFound: "No such screen",
  reasons: {
    "not-a-url": "Not a URL with an authority.",
    "wrong-scheme": "Only spark-ks:// links open Kitchen Sink screens.",
    "bad-path": `Use ${SCHEME_HINT}.`,
    "bad-encoding": "The link contains malformed percent-encoding.",
  },
  unknownArea: area => `No area named "${area}".`,
  unknownScreen: (areaTitle, screen) => `${areaTitle} has no screen named "${screen}".`,
  setupFailed: message => `Kitchen Sink setup failed: ${message}`,
  theme: (current, next) => `Theme: ${enThemes[current]} → ${enThemes[next]}`,
  documentMenu: "Document",
  openItem: "Open…",
  saveItem: "Save…",
  openDialogTitle: "Open a text document",
  untitledName: "Hello.txt",
  unsavedTitle: "Unsaved document",
  unsavedMessage: "Discard your changes?",
  keepEditing: "Keep editing",
  discard: "Discard",
  number: String,
  areas: {
    "infra": "Gate infrastructure",
    "app-lifecycle": "App lifecycle",
    "windows": "Windows",
    "toolbar-title-bar": "Toolbar & title bar",
    "menus": "Menus",
    "keyboard": "Keyboard",
    "pointer-trackpad": "Pointer & trackpad",
    "text-input-editing": "Text input & editing",
    "native-controls": "Native controls",
    "appearance-theming": "Appearance & theming",
    "displays-graphics": "Displays & graphics",
    "files-filesystem": "Files & filesystem",
    "dialogs": "Dialogs",
    "document-model": "Document model",
    "clipboard": "Clipboard",
    "drag-drop": "Drag & drop",
    "notifications": "Notifications",
    "system-integration": "System integration",
    "media": "Media",
    "networking-webview": "Networking & WebView",
    "processes-ipc": "Processes & IPC",
    "storage-data": "Storage & data",
    "authentication": "Authentication",
    "updates": "Updates",
    "packaging-distribution": "Packaging & distribution",
    "accessibility": "Accessibility",
    "internationalization": "Internationalization",
    "performance-budgets": "Performance budgets",
    "reliability-diagnostics": "Reliability & diagnostics",
    "security": "Security",
    "developer-experience": "Developer experience",
    "edge-abuse-cases": "Edge & abuse cases",
    "motion-system": "Motion system",
    "flourishes-micro-interactions": "Flourishes & micro-interactions",
    "multiwindow": "Multiwindow",
    "component-library": "Component library",
    "future-facing-capabilities": "Future-facing capabilities",
  },
};

// CLDR Arabic plural categories: zero, one, two, few (3–10), many (11–99), other.
function arabicScreens(count: number) {
  const rest = count % 100;
  if (count === 0) return "لا توجد شاشات";
  if (count === 1) return "شاشة واحدة";
  if (count === 2) return "شاشتان";
  return `${arabicDigits(count)} ${rest >= 3 && rest <= 10 ? "شاشات" : "شاشة"}`;
}

const ar: Messages = {
  appTitle: "Kitchen Sink",
  subtitle: (mode, projectId) => `${mode ?? "غير معروف"} · ${projectId ?? "بلا مشروع"}`,
  allScreens: "كل الشاشات",
  screens: arabicScreens,
  navLabel: (title, count) => `${title}، ${arabicScreens(count)}`,
  home: (populated, total) => `المجالات التي لها شاشات: ${arabicDigits(populated)} من ${arabicDigits(total)}. تُفتح كل شاشة من ${SCHEME_HINT}.`,
  areaChecks: (prefix, area, url) => `الفحوص ${prefix}-… · e2e/checks/${area}.yaml · ${url}`,
  areaEmpty: area => `لا توجد شاشات مسجّلة بعد. أضفها في screens/${area}/index.tsx.`,
  notFound: "لا توجد شاشة بهذا الاسم",
  reasons: {
    "not-a-url": "ليس رابطًا يحتوي على مضيف.",
    "wrong-scheme": "روابط spark-ks:// وحدها تفتح شاشات Kitchen Sink.",
    "bad-path": `استخدم ${SCHEME_HINT}.`,
    "bad-encoding": "يحتوي الرابط على ترميز نسبة مئوية غير صالح.",
  },
  unknownArea: area => `لا يوجد مجال باسم "${area}".`,
  unknownScreen: (areaTitle, screen) => `لا توجد في ${areaTitle} شاشة باسم "${screen}".`,
  setupFailed: message => `تعذّر إعداد Kitchen Sink: ${message}`,
  theme: (current, next) => `المظهر: ${arThemes[current]} ← ${arThemes[next]}`,
  documentMenu: "المستند",
  openItem: "فتح…",
  saveItem: "حفظ…",
  openDialogTitle: "افتح مستندًا نصيًا",
  untitledName: "مرحبا.txt",
  unsavedTitle: "مستند غير محفوظ",
  unsavedMessage: "هل تريد تجاهل تغييراتك؟",
  keepEditing: "متابعة التحرير",
  discard: "تجاهل",
  number: arabicDigits,
  areas: {
    "infra": "بنية بوابة الإصدار",
    "app-lifecycle": "دورة حياة التطبيق",
    "windows": "النوافذ",
    "toolbar-title-bar": "شريط الأدوات وشريط العنوان",
    "menus": "القوائم",
    "keyboard": "لوحة المفاتيح",
    "pointer-trackpad": "المؤشر ولوحة التتبع",
    "text-input-editing": "إدخال النص وتحريره",
    "native-controls": "عناصر التحكم الأصلية",
    "appearance-theming": "المظهر والسمات",
    "displays-graphics": "الشاشات والرسومات",
    "files-filesystem": "الملفات ونظام الملفات",
    "dialogs": "مربعات الحوار",
    "document-model": "نموذج المستندات",
    "clipboard": "الحافظة",
    "drag-drop": "السحب والإفلات",
    "notifications": "الإشعارات",
    "system-integration": "التكامل مع النظام",
    "media": "الوسائط",
    "networking-webview": "الشبكات وعرض الويب",
    "processes-ipc": "العمليات والاتصال بينها",
    "storage-data": "التخزين والبيانات",
    "authentication": "المصادقة",
    "updates": "التحديثات",
    "packaging-distribution": "الحزم والتوزيع",
    "accessibility": "إمكانية الوصول",
    "internationalization": "التدويل",
    "performance-budgets": "ميزانيات الأداء",
    "reliability-diagnostics": "الموثوقية والتشخيص",
    "security": "الأمان",
    "developer-experience": "تجربة المطوّر",
    "edge-abuse-cases": "الحالات الحدّية وإساءة الاستخدام",
    "motion-system": "نظام الحركة",
    "flourishes-micro-interactions": "اللمسات والتفاعلات الدقيقة",
    "multiwindow": "النوافذ المتعددة",
    "component-library": "مكتبة المكوّنات",
    "future-facing-capabilities": "القدرات المستقبلية",
  },
};

export const MESSAGES = { en, ar } as const;
export type Locale = keyof typeof MESSAGES;
const RTL: ReadonlySet<Locale> = new Set(["ar"]);

/** Maps a system locale such as "ar_EG", "ar-EG" or "en_US@calendar=…" to a catalog. */
export function resolveLocale(tag: string): Locale {
  const language = tag.split(/[-_@.]/)[0]!.toLowerCase();
  return (Object.keys(MESSAGES) as Locale[]).find(locale => locale === language) ?? "en";
}
export function isRTL(locale: Locale) { return RTL.has(locale); }
