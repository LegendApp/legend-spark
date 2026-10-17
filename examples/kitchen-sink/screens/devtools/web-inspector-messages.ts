import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for DevTools › Web Inspector. Availability comes from the API, so flows can assert it in any locale.
export type WebInspectorMessages = {
  title: string;
  intro: string;
  sections: { availability: string; default: string; optIn: string; attach: string };
  unavailable: string;
  development: string;
  release: string;
  defaultPage: string;
  optIn: string;
  optInPage: string;
  mount: string;
  unmount: string;
  attach: string;
};

const en: WebInspectorMessages = {
  title: "Web Inspector",
  intro: "Safari's Web Inspector attaches to a WebView's page: its elements, styles, console, network, sources and storage. A WebView is inspectable in development bundles unless it sets inspectable: false, and in release bundles only when it sets inspectable: true.",
  sections: { availability: "Availability", default: "A WebView with the default", optIn: "A WebView that opts in", attach: "Attach Safari" },
  unavailable: "Safari's Web Inspector is for WebViews on macOS. On Windows, WebView2 DevTools follow WebView2's default.",
  development: "This is a development bundle: the WebView below is inspectable.",
  release: "This is not a development bundle: the WebView below is not inspectable.",
  defaultPage: "This page sets no inspectable prop.",
  optIn: "This WebView sets inspectable: true, so it is inspectable in a release build too. Opt in only for WebViews whose content you are willing to expose.",
  optInPage: "This page sets inspectable: true.",
  mount: "Show the opt-in WebView",
  unmount: "Hide the opt-in WebView",
  attach: "In Safari, turn on Settings › Advanced › Show features for web developers. Then choose Develop › this Mac › KitchenSink, and the page to inspect.",
};

const ar: WebInspectorMessages = {
  title: "فاحص الويب",
  intro: "يتصل فاحص الويب في Safari بصفحة عرض الويب: عناصرها وأنماطها ووحدة التحكم والشبكة والمصادر والتخزين. يمكن فحص عرض الويب في حزم التطوير ما لم يضبط inspectable: false، وفي حزم الإصدار فقط إذا ضبط inspectable: true.",
  sections: { availability: "التوفر", default: "عرض ويب بالإعداد الافتراضي", optIn: "عرض ويب يسمح بالفحص صراحةً", attach: "اربط Safari" },
  unavailable: "فاحص الويب في Safari لعروض الويب على macOS. على Windows تتبع أدوات مطوّري WebView2 الإعداد الافتراضي لـ WebView2.",
  development: "هذه حزمة تطوير: يمكن فحص عرض الويب أدناه.",
  release: "هذه ليست حزمة تطوير: لا يمكن فحص عرض الويب أدناه.",
  defaultPage: "لا تضبط هذه الصفحة الخاصية inspectable.",
  optIn: "يضبط عرض الويب هذا inspectable: true، لذا يمكن فحصه في نسخة الإصدار أيضًا. اسمح بالفحص فقط لعروض الويب التي تقبل كشف محتواها.",
  optInPage: "تضبط هذه الصفحة inspectable: true.",
  mount: "إظهار عرض الويب المسموح بفحصه",
  unmount: "إخفاء عرض الويب المسموح بفحصه",
  attach: "في Safari فعّل الإعدادات › متقدم › إظهار ميزات مطوّري الويب. ثم اختر Develop › هذا الـ Mac › KitchenSink، والصفحة التي تريد فحصها.",
};

export const WEB_INSPECTOR_MESSAGES: Record<Locale, WebInspectorMessages> = { en, ar };
export function useWebInspectorMessages() { return WEB_INSPECTOR_MESSAGES[useI18n().locale]; }
