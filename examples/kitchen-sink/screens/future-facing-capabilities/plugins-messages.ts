import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Plugins screen. Plugin names, IDs, states, results, contributions and command output are API data,
// so flows can assert them in any locale; they are not translated.
export type PluginsMessages = {
  title: string; intro: string; availability: string; declared: string; registered: string; output: string;
  load: string; unload: string; none: string; openSample: string; panelLabel: string; security: string;
  commands: string; menuItems: string; fileTypes: string; panels: string; menu: string;
};

const en: PluginsMessages = {
  title: "Plugins",
  intro: "Five plugins ship with the Kitchen Sink. Each loads into its own isolated JavaScript runtime after the host checks its manifest, API version and granted capabilities; what it registers is checked again before it appears below.",
  availability: "Availability", declared: "Declared plugins", registered: "Registered contributions", output: "Last command",
  load: "Load", unload: "Unload", none: "Nothing registered. Load Hello or Echo.", openSample: "Open sample.ksnote",
  panelLabel: "Rendered by the Hello plugin", commands: "Commands", menuItems: "Menu items", fileTypes: "File types", panels: "Panels", menu: "Plugins",
  security: "Plugins load only from code bundled with the app; nothing is downloaded or evaluated. Plugin runtimes do not restrict native modules yet (#391).",
};

const ar: PluginsMessages = {
  title: "الإضافات",
  intro: "تأتي خمس إضافات مع Kitchen Sink. تُحمَّل كل إضافة في بيئة JavaScript معزولة خاصة بها بعد أن يتحقق المضيف من بيانها وإصدار الواجهة والقدرات الممنوحة؛ ويُتحقق مما تسجله مرة أخرى قبل أن يظهر أدناه.",
  availability: "التوفر", declared: "الإضافات المعلنة", registered: "المساهمات المسجلة", output: "آخر أمر",
  load: "تحميل", unload: "إلغاء التحميل", none: "لا شيء مسجل. حمّل Hello أو Echo.", openSample: "فتح sample.ksnote",
  panelLabel: "تعرضها إضافة Hello", commands: "الأوامر", menuItems: "عناصر القائمة", fileTypes: "أنواع الملفات", panels: "اللوحات", menu: "الإضافات",
  security: "تُحمَّل الإضافات من الشيفرة المضمنة في التطبيق فقط؛ لا يُنزَّل أو يُقيَّم أي شيء. لا تقيّد بيئات الإضافات الوحدات الأصلية بعد (#391).",
};

export const PLUGINS_MESSAGES: Record<Locale, PluginsMessages> = { en, ar };
export function usePluginsMessages() { return PLUGINS_MESSAGES[useI18n().locale]; }
