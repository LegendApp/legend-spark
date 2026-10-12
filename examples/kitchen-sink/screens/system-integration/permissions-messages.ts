import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";
import type { PermissionKind } from "@legendapp/spark/permissions";

// Strings for the Privacy permissions screen. States, results, events and availability are API data, so flows can
// assert them in any locale; they are not translated.
export type PermissionsMessages = {
  title: string; intro: string; availability: string; permissions: string; events: string;
  request: string; settings: string; listening: string; subscribing: string; noEvents: string; driver: string; failed: string; reading: string;
  kinds: Record<PermissionKind, string>;
};

const en: PermissionsMessages = {
  title: "Privacy permissions",
  intro: "Each permission's state as macOS reports it. Opening this screen only reads them; Request shows the system prompt when macOS can, and Settings opens its Privacy & Security pane.",
  availability: "Availability", permissions: "Permissions", events: "Changes",
  request: "Request", settings: "Settings",
  listening: "Listening for permission changes.", subscribing: "Subscribing to permission changes…",
  noEvents: "None yet. Changes arrive after a request, and when the app becomes active after you change System Settings.",
  driver: "In a test-driver run these states are simulated: no prompt appears and System Settings never opens.",
  failed: "Failed:", reading: "Reading…",
  kinds: {
    camera: "Camera", microphone: "Microphone", screenRecording: "Screen recording", accessibility: "Accessibility", inputMonitoring: "Input monitoring",
    automation: "Automation (Finder)", contacts: "Contacts", calendar: "Calendar", photos: "Photos", location: "Location", speechRecognition: "Speech recognition",
  },
};

const ar: PermissionsMessages = {
  title: "أذونات الخصوصية",
  intro: "حالة كل إذن كما يبلغ عنها macOS. فتح هذه الشاشة يقرأ الحالات فقط؛ «طلب» يعرض نافذة النظام عندما يستطيع macOS ذلك، و«الإعدادات» تفتح قسمه في الخصوصية والأمن.",
  availability: "التوفر", permissions: "الأذونات", events: "التغييرات",
  request: "طلب", settings: "الإعدادات",
  listening: "الاستماع لتغييرات الأذونات.", subscribing: "جارٍ الاشتراك في تغييرات الأذونات…",
  noEvents: "لا شيء بعد. تصل التغييرات بعد الطلب، وعندما يصبح التطبيق نشطًا بعد تغيير إعدادات النظام.",
  driver: "في تشغيل برنامج الاختبار تكون هذه الحالات محاكاة: لا تظهر أي نافذة ولا تُفتح إعدادات النظام.",
  failed: "فشل:", reading: "جارٍ القراءة…",
  kinds: {
    camera: "الكاميرا", microphone: "الميكروفون", screenRecording: "تسجيل الشاشة", accessibility: "تسهيلات الاستخدام", inputMonitoring: "مراقبة الإدخال",
    automation: "الأتمتة (Finder)", contacts: "جهات الاتصال", calendar: "التقويم", photos: "الصور", location: "الموقع", speechRecognition: "التعرف على الكلام",
  },
};

export const PERMISSIONS_MESSAGES: Record<Locale, PermissionsMessages> = { en, ar };
export function usePermissionsMessages() { return PERMISSIONS_MESSAGES[useI18n().locale]; }
