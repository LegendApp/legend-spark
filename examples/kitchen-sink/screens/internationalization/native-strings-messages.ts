import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Native strings screen. Language identifiers and availability JSON are API data, not translated.
type NativeStringsMessages = {
  title: string; intro: string; loading: string;
  availability: string; supported: string; current: string; override: string; framework: string; followsSystem: string;
  choose: string; use(language: string): string; followSystem: string; relaunch: string;
  saved(language: string | null): string; failed: string;
  dialogs: string; confirm: string; confirmMessage: string; confirmed: string; canceled: string;
};

const en: NativeStringsMessages = {
  title: "Native strings",
  intro: "Menus, dialog buttons, the About panel, the find bar, toolbar customization, window tabs and Services come from Spark and AppKit, not from this screen. They use the current language below. Open the Edit or Window menu to see them.",
  loading: "Reading the app's languages…",
  availability: "Availability", supported: "Languages the app lists", current: "Current language", override: "Per-app language", framework: "Spark's own strings", followsSystem: "None: follows the system",
  choose: "Choose this app's language. It applies at the next launch, as the choice in System Settings › Language & Region › Applications does.",
  use: language => `Use ${language}`, followSystem: "Follow the system", relaunch: "Relaunch to apply",
  saved: language => language ? `Saved ${language} for the next launch.` : "Saved: the next launch follows the system.", failed: "Failed:",
  dialogs: "A confirmation that passes no title or button labels gets Spark's own, in the current language.",
  confirm: "Confirm with Spark's labels", confirmMessage: "This dialog's title and buttons are Spark's defaults.", confirmed: "Continue", canceled: "Cancel",
};

const ar: NativeStringsMessages = {
  title: "النصوص الأصلية",
  intro: "القوائم وأزرار مربعات الحوار ولوحة «حول» وشريط البحث وتخصيص شريط الأدوات وعلامات تبويب النوافذ والخدمات تأتي من Spark وAppKit، لا من هذه الشاشة. وهي تستخدم اللغة الحالية أدناه. افتح قائمة «تعديل» أو «نافذة» لرؤيتها.",
  loading: "جارٍ قراءة لغات التطبيق…",
  availability: "التوفر", supported: "اللغات التي يدرجها التطبيق", current: "اللغة الحالية", override: "لغة التطبيق", framework: "نصوص Spark الخاصة", followsSystem: "لا شيء: يتبع النظام",
  choose: "اختر لغة هذا التطبيق. تُطبَّق عند التشغيل التالي، كما في إعدادات النظام › اللغة والمنطقة › التطبيقات.",
  use: language => `استخدام ${language}`, followSystem: "اتباع النظام", relaunch: "إعادة التشغيل للتطبيق",
  saved: language => language ? `حُفظت ${language} للتشغيل التالي.` : "حُفظ: سيتبع التشغيل التالي النظام.", failed: "فشل:",
  dialogs: "مربع التأكيد الذي لا يمرّر عنوانًا ولا تسميات للأزرار يحصل على تسميات Spark الخاصة باللغة الحالية.",
  confirm: "تأكيد بتسميات Spark", confirmMessage: "عنوان هذا المربع وأزراره هي الافتراضية في Spark.", confirmed: "متابعة", canceled: "إلغاء",
};

const MESSAGES: Record<Locale, NativeStringsMessages> = { en, ar };
export function useNativeStringsMessages(): NativeStringsMessages { return MESSAGES[useI18n().locale]; }
