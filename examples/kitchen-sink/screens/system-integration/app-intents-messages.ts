import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the App Intents & Shortcuts screen. Statuses, results, events and availability are API data, so flows can
// assert them in any locale; they are not translated.
export type AppIntentsMessages = {
  title: string; intro: string; availability: string; declared: string; failed: string;
  handlers: string; handlersHint: string; listen: string; registering: string;
  donation: string; donationHint: string; donate: string;
  events: string; noEvents: string; driver: string;
};

const en: AppIntentsMessages = {
  title: "App Intents & Shortcuts",
  intro: "Actions the app offers to Shortcuts, Spotlight and Siri, each run by a JavaScript handler. Opening this screen only registers the handlers; nothing is donated until you press a button.",
  availability: "Availability", declared: "Declared intents", failed: "Failed:",
  handlers: "Handlers",
  handlersHint: "Show Recipe answers with text; Start Timer refuses more than 60 minutes; Open Note opens a note that the KsNote query handler lists and finds. The Kitchen Sink declares no intents, so outside a test-driver run the handlers report E_UNAVAILABLE.",
  listen: "Listen again", registering: "Registering…",
  donation: "Donation", donationHint: "Tells the system you just showed the Pancakes recipe for 2, so Siri and Spotlight can suggest it.", donate: "Donate Show Recipe",
  events: "Received", noEvents: "None yet. Invocations and entity queries from Shortcuts, Spotlight and Siri appear here.",
  driver: "In a test-driver run App Intents are simulated: the driver declares and runs them, and nothing reaches Shortcuts, Spotlight or Siri.",
};

const ar: AppIntentsMessages = {
  title: "App Intents والاختصارات",
  intro: "إجراءات يقدّمها التطبيق إلى Shortcuts وSpotlight وSiri، ويشغّل كلًّا منها معالج JavaScript. فتح هذه الشاشة يسجّل المعالجات فقط؛ لا يُتبرَّع بأي شيء حتى تضغط زرًا.",
  availability: "التوفر", declared: "الإجراءات المعلنة", failed: "فشل:",
  handlers: "المعالجات",
  handlersHint: "يجيب «عرض الوصفة» بنص؛ ويرفض «بدء المؤقت» أكثر من 60 دقيقة؛ ويفتح «فتح ملاحظة» ملاحظة يسردها معالج استعلام KsNote ويجدها. لا يعلن Kitchen Sink عن أي إجراءات، لذا خارج تشغيل برنامج الاختبار تكون حالة المعالجات E_UNAVAILABLE.",
  listen: "الاستماع مجددًا", registering: "جارٍ التسجيل…",
  donation: "التبرع", donationHint: "يخبر النظام بأنك عرضت للتو وصفة Pancakes لشخصين، ليقترحها Siri وSpotlight لاحقًا.", donate: "التبرع بـ «عرض الوصفة»",
  events: "المستلَم", noEvents: "لا شيء بعد. تظهر هنا الاستدعاءات واستعلامات الكيانات من Shortcuts وSpotlight وSiri.",
  driver: "في تشغيل برنامج الاختبار تكون App Intents محاكاة: يعلنها برنامج الاختبار ويشغّلها، ولا يصل أي شيء إلى Shortcuts أو Spotlight أو Siri.",
};

export const APP_INTENTS_MESSAGES: Record<Locale, AppIntentsMessages> = { en, ar };
export function useAppIntentsMessages() { return APP_INTENTS_MESSAGES[useI18n().locale]; }
