import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";
import type { ShareKind } from "./sharing-demo";

// Strings for the Sharing & Spotlight screen. Results, statuses, events and availability are API data, so flows can
// assert them in any locale; they are not translated.
export type SharingMessages = {
  title: string; intro: string; availability: string; failed: string;
  share: string; shareKinds: Record<ShareKind, string>;
  services: string; serviceHint(name: string): string; registering: string; listen: string;
  spotlight: string; spotlightHint: string; index: string; remove: string;
  defaultHandler: string; reading: string; makeDefault: string;
  events: string; noEvents: string; driver: string;
};

const en: SharingMessages = {
  title: "Sharing & Spotlight",
  intro: "The share picker, a Services menu provider, Core Spotlight items and the default handler for spark-ks links. Opening this screen only starts listening; nothing is shared, indexed or changed until you press a button.",
  availability: "Availability", failed: "Failed:",
  share: "Share", shareKinds: { text: "Share text", link: "Share a link", file: "Share a file" },
  services: "Services",
  serviceHint: name => `Listens for the service “${name}”. The Kitchen Sink declares no Services, so outside a test-driver run this reports E_UNAVAILABLE.`,
  registering: "Registering…", listen: "Listen again",
  spotlight: "Spotlight", spotlightHint: "Indexes three sample recipes (Pancakes, Gazpacho, Shortbread) in the ks-recipes domain; Delete removes that domain.",
  index: "Index recipes", remove: "Delete recipes",
  defaultHandler: "Default handler for spark-ks", reading: "Reading…", makeDefault: "Make default",
  events: "Received", noEvents: "None yet. Service invocations, opened Spotlight items and universal links appear here.",
  driver: "In a test-driver run sharing is simulated: no picker appears, and the Spotlight index, the Services menu and the default handler are never changed.",
};

const ar: SharingMessages = {
  title: "المشاركة وSpotlight",
  intro: "منتقي المشاركة، ومزوّد لقائمة الخدمات، وعناصر Core Spotlight، والمعالج الافتراضي لروابط spark-ks. فتح هذه الشاشة يبدأ الاستماع فقط؛ لا تتم مشاركة أو فهرسة أو تغيير أي شيء حتى تضغط زرًا.",
  availability: "التوفر", failed: "فشل:",
  share: "المشاركة", shareKinds: { text: "مشاركة نص", link: "مشاركة رابط", file: "مشاركة ملف" },
  services: "الخدمات",
  serviceHint: name => `يستمع للخدمة «${name}». لا يعلن Kitchen Sink عن أي خدمات، لذا خارج تشغيل برنامج الاختبار تكون النتيجة E_UNAVAILABLE.`,
  registering: "جارٍ التسجيل…", listen: "الاستماع مجددًا",
  spotlight: "Spotlight", spotlightHint: "يفهرس ثلاث وصفات تجريبية (Pancakes وGazpacho وShortbread) في النطاق ks-recipes؛ «حذف» يزيل هذا النطاق.",
  index: "فهرسة الوصفات", remove: "حذف الوصفات",
  defaultHandler: "المعالج الافتراضي لـ spark-ks", reading: "جارٍ القراءة…", makeDefault: "تعيين كافتراضي",
  events: "المستلَم", noEvents: "لا شيء بعد. تظهر هنا استدعاءات الخدمة وعناصر Spotlight المفتوحة والروابط العامة.",
  driver: "في تشغيل برنامج الاختبار تكون المشاركة محاكاة: لا يظهر أي منتقٍ، ولا يتغير فهرس Spotlight ولا قائمة الخدمات ولا المعالج الافتراضي.",
};

export const SHARING_MESSAGES: Record<Locale, SharingMessages> = { en, ar };
export function useSharingMessages() { return SHARING_MESSAGES[useI18n().locale]; }
