import { useI18n } from "../../shell/app-controller";
import { MESSAGES, type Locale } from "../../shell/i18n";

// Strings for the App icon screen. Pixel dimensions are what the PNGs report, so flows assert them in any locale.
export type AppIconMessages = { title: string; intro: string; availability: string; rendered: string; loading: string; styles: string; size: (pixels: number) => string; image: (pixels: number) => string };

const en: AppIconMessages = {
  title: "App icon",
  intro: "getAppIcon() draws this app's icon the way Finder and the Dock do, at each size they use. On macOS 26 and later it follows the icon and widget style: default, dark, clear or tinted.",
  availability: "Availability",
  rendered: "Rendered icons",
  loading: "Rendering the app icon…",
  styles: "Flows render the dark, clear and tinted styles by launching with -AppleIconAppearanceTheme, which applies to this process only: the Mac's settings and its Dock are untouched. The build audit checks the icon's sizes and styles in the app bundle.",
  size: pixels => `${pixels} px`,
  image: pixels => `App icon, ${pixels} px`,
};

const n = MESSAGES.ar.number;
const ar: AppIconMessages = {
  title: "أيقونة التطبيق",
  intro: "يرسم getAppIcon() أيقونة هذا التطبيق كما يرسمها Finder وDock، بكل حجم يستخدمانه. في macOS 26 وما بعده يتبع نمط الأيقونات والأدوات: افتراضي أو داكن أو شفاف أو ملوّن.",
  availability: "التوفر",
  rendered: "الأيقونات المرسومة",
  loading: "جارٍ رسم أيقونة التطبيق…",
  styles: "ترسم التدفقات الأنماط الداكنة والشفافة والملوّنة بالتشغيل مع -AppleIconAppearanceTheme، الذي يسري على هذه العملية وحدها: لا تتغير إعدادات جهاز Mac ولا Dock. ويتحقق تدقيق البناء من أحجام الأيقونة وأنماطها في حزمة التطبيق.",
  size: pixels => `${n(pixels)} بكسل`,
  image: pixels => `أيقونة التطبيق، ${n(pixels)} بكسل`,
};

export const APP_ICON_MESSAGES: Record<Locale, AppIconMessages> = { en, ar };
export function useAppIconMessages() { return APP_ICON_MESSAGES[useI18n().locale]; }
