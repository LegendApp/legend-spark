// Developer menu strings. Development builds only (imported by developer-menu.ts).
export interface DeveloperMenuMessages {
  menu: string;
  reload: string;
  openDevTools: string;
  devToolsUnavailable: string;
  toggleInspector: string;
  togglePerfMonitor: string;
  fastRefresh: string;
  bundleInfo: string;
  startProfiling: string;
  stopProfiling: string;
  profilerUnavailable: string;
  /** The Stop Profiling folder panel's button and message. */
  saveProfile: string;
  saveProfileMessage: string;
  showMenu: string;
  bundleInfoTitle: string;
  bundleURL: string;
  runtime: string;
  sharedRuntime: string;
  /** `{name}` is replaced with the runtime name. */
  isolatedRuntime: string;
  mode: string;
  development: string;
  developmentBridgeless: string;
  engine: string;
  notHermes: string;
  reactNative: string;
  spark: string;
  copy: string;
  ok: string;
}

const en: DeveloperMenuMessages = {
  menu: "Developer",
  reload: "Reload",
  openDevTools: "Open DevTools",
  devToolsUnavailable: "React Native DevTools is not available in this build.",
  toggleInspector: "Toggle Element Inspector",
  togglePerfMonitor: "Toggle Performance Monitor",
  fastRefresh: "Fast Refresh",
  bundleInfo: "Show Bundle Info",
  startProfiling: "Start Profiling",
  stopProfiling: "Stop Profiling…",
  profilerUnavailable: "The profiler is not available in this build.",
  saveProfile: "Save Profile Here",
  saveProfileMessage: "Choose a folder for the profile: a Chrome trace and a .cpuprofile for each JavaScript runtime.",
  showMenu: "Show Developer Menu",
  bundleInfoTitle: "Bundle Info",
  bundleURL: "Bundle URL",
  runtime: "Runtime",
  sharedRuntime: "Shared runtime",
  isolatedRuntime: "Isolated runtime “{name}”",
  mode: "Mode",
  development: "Development",
  developmentBridgeless: "Development, New Architecture (bridgeless)",
  engine: "JavaScript engine",
  notHermes: "Not Hermes",
  reactNative: "React Native",
  spark: "Spark",
  copy: "Copy",
  ok: "OK",
};

const ar: DeveloperMenuMessages = {
  menu: "المطوّر",
  reload: "إعادة التحميل",
  openDevTools: "فتح أدوات المطوّر",
  devToolsUnavailable: "أدوات React Native للمطوّر غير متاحة في هذا الإصدار.",
  toggleInspector: "تبديل فاحص العناصر",
  togglePerfMonitor: "تبديل مراقب الأداء",
  fastRefresh: "التحديث السريع",
  bundleInfo: "عرض معلومات الحزمة",
  startProfiling: "بدء تحليل الأداء",
  stopProfiling: "إيقاف تحليل الأداء…",
  profilerUnavailable: "محلّل الأداء غير متاح في هذا الإصدار.",
  saveProfile: "حفظ التحليل هنا",
  saveProfileMessage: "اختر مجلدًا للتحليل: ملف تتبّع Chrome وملف ‎.cpuprofile لكل بيئة تشغيل JavaScript.",
  showMenu: "عرض قائمة المطوّر",
  bundleInfoTitle: "معلومات الحزمة",
  bundleURL: "عنوان الحزمة",
  runtime: "بيئة التشغيل",
  sharedRuntime: "بيئة التشغيل المشتركة",
  isolatedRuntime: "بيئة التشغيل المعزولة «{name}»",
  mode: "الوضع",
  development: "التطوير",
  developmentBridgeless: "التطوير، البنية الجديدة (بلا جسر)",
  engine: "محرّك JavaScript",
  notHermes: "ليس Hermes",
  reactNative: "React Native",
  spark: "Spark",
  copy: "نسخ",
  ok: "حسنًا",
};

const catalogs: Record<string, DeveloperMenuMessages> = { en, ar };

/** Picks the catalog for a system locale such as "ar_EG" or "en-US"; languages without one use English. */
export function developerMenuMessages(locale: string): DeveloperMenuMessages {
  return catalogs[locale.split(/[-_@.]/)[0]!.toLowerCase()] ?? en;
}
