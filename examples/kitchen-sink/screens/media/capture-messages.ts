import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Capture screen. Availability, devices, permissions, levels and results are API data, so flows can
// assert them in any locale; they are not translated.
export type CaptureMessages = {
  title: string; intro: string; availability: string; permissions: string; microphone: string; camera: string; screen: string;
  refresh: string; request: string; record: string; stop: string; cancel: string; startCamera: string; takePhoto: string; stopCamera: string;
  listSources: string; screenshot: string; recordScreen: string; stopScreen: string;
  reading: string; noLevel: string; notRecorded: string; noCamera: string; noPhoto: string; noSources: string; noScreenshot: string;
  previewLabel: string; driver: string;
};

const en: CaptureMessages = {
  title: "Capture",
  intro: "The microphone, the camera and the screen as macOS provides them. Opening this screen only reads devices and permissions; nothing records or turns a camera on until you press a button, and capture never asks for a permission itself.",
  availability: "Availability and devices", permissions: "Permissions", microphone: "Microphone", camera: "Camera", screen: "Screen",
  refresh: "Refresh", request: "Request permissions", record: "Record", stop: "Stop", cancel: "Discard", startCamera: "Start camera", takePhoto: "Take photo", stopCamera: "Stop camera",
  listSources: "List displays and windows", screenshot: "Screenshot", recordScreen: "Record screen", stopScreen: "Stop recording",
  reading: "Reading…", noLevel: "No level yet.", notRecorded: "Not recorded yet.", noCamera: "Camera off.", noPhoto: "No photo yet.", noSources: "Not listed yet.", noScreenshot: "No screenshot yet.",
  previewLabel: "Camera preview",
  driver: "In a test-driver run every device is simulated: synthetic levels, camera frames and screens, written to real files, with no microphone, camera or screen reached. The Kitchen Sink has no camera or microphone entitlement, so a hardened-runtime build of it reports missing-entitlement.",
};

const ar: CaptureMessages = {
  title: "الالتقاط",
  intro: "الميكروفون والكاميرا والشاشة كما يوفرها macOS. فتح هذه الشاشة يقرأ الأجهزة والأذونات فقط؛ لا شيء يُسجَّل ولا تعمل الكاميرا حتى تضغط زرًا، ولا يطلب الالتقاط أي إذن بنفسه أبدًا.",
  availability: "التوفر والأجهزة", permissions: "الأذونات", microphone: "الميكروفون", camera: "الكاميرا", screen: "الشاشة",
  refresh: "تحديث", request: "طلب الأذونات", record: "تسجيل", stop: "إيقاف", cancel: "تجاهل", startCamera: "تشغيل الكاميرا", takePhoto: "التقاط صورة", stopCamera: "إيقاف الكاميرا",
  listSources: "عرض الشاشات والنوافذ", screenshot: "لقطة شاشة", recordScreen: "تسجيل الشاشة", stopScreen: "إيقاف التسجيل",
  reading: "جارٍ القراءة…", noLevel: "لا مستوى بعد.", notRecorded: "لم يُسجَّل شيء بعد.", noCamera: "الكاميرا متوقفة.", noPhoto: "لا صورة بعد.", noSources: "لم تُعرض بعد.", noScreenshot: "لا لقطة شاشة بعد.",
  previewLabel: "معاينة الكاميرا",
  driver: "في تشغيل برنامج الاختبار تكون كل الأجهزة محاكاة: مستويات وإطارات كاميرا وشاشات اصطناعية تُكتب في ملفات حقيقية، دون الوصول إلى الميكروفون أو الكاميرا أو الشاشة. لا يملك Kitchen Sink استحقاق الكاميرا أو الميكروفون، لذا يبلّغ إصداره ذو وقت التشغيل المحصّن عن missing-entitlement.",
};

export const CAPTURE_MESSAGES: Record<Locale, CaptureMessages> = { en, ar };
export function useCaptureMessages() { return CAPTURE_MESSAGES[useI18n().locale]; }
