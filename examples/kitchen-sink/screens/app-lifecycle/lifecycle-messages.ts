import type { AppLaunch } from "@legendapp/spark/app";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the app-lifecycle screens. Paths, arguments, URLs and availability JSON are API data, not translated.
type LifecycleMessages = {
  title: string; intro: string; loading: string;
  availability: string; instance: string; safeMode: string; relaunched: string; arguments: string;
  instanceValue: Record<AppLaunch["instance"], string>;
  safeModeValue: Record<"off" | "flag" | "modifier", string>;
  safeModeHint: string; yes: string; no: string;
  secondLaunches: string; noLaunches: string; workingDirectory: string; files: string; urls: string; none: string;
  relaunch: string; relaunchSafe: string; relaunchNormal: string; vetoQuit: string; allowQuit: string;
  pending: string; approved: string; vetoed: string; failed: string;
};

const en: LifecycleMessages = {
  title: "Launch & single instance",
  intro: "One process runs per project. A later launch forwards its arguments, files and URLs here, then exits.",
  loading: "Reading launch state…",
  availability: "Availability", instance: "Instance", safeMode: "Safe mode", relaunched: "Relaunched", arguments: "Launch arguments",
  instanceValue: { primary: "Owns the single-instance lock", "test-driver": "Test-driver session (lock not taken)" },
  safeModeValue: { off: "Off", flag: "On: launched with --spark-safe-mode", modifier: "On: Shift held at launch" },
  safeModeHint: "Hold Shift while the app launches, or pass --spark-safe-mode, to skip restoring saved windows and frames.",
  yes: "Yes", no: "No",
  secondLaunches: "Second launches", noLaunches: "None yet. Launch the app again, or open a file or URL with it.",
  workingDirectory: "Working directory", files: "Files", urls: "URLs", none: "None",
  relaunch: "Relaunch", relaunchSafe: "Relaunch in safe mode", relaunchNormal: "Relaunch normally",
  vetoQuit: "Veto quit requests", allowQuit: "Stop vetoing quit",
  pending: "Waiting for the quit decision…", approved: "Quit approved; the new instance takes over.",
  vetoed: "Quit vetoed; the new instance was stopped.", failed: "Relaunch failed:",
};

const ar: LifecycleMessages = {
  title: "التشغيل والنسخة الواحدة",
  intro: "تعمل عملية واحدة لكل مشروع. يمرّر التشغيل اللاحق وسائطه وملفاته وروابطه إلى هنا ثم يُغلق.",
  loading: "جارٍ قراءة حالة التشغيل…",
  availability: "التوفر", instance: "النسخة", safeMode: "الوضع الآمن", relaunched: "أُعيد تشغيله", arguments: "وسائط التشغيل",
  instanceValue: { primary: "يملك قفل النسخة الواحدة", "test-driver": "جلسة مشغّل الاختبار (لم يُؤخذ القفل)" },
  safeModeValue: { off: "متوقف", flag: "مفعّل: شُغّل مع ‎--spark-safe-mode", modifier: "مفعّل: كان مفتاح Shift مضغوطًا عند التشغيل" },
  safeModeHint: "اضغط مفتاح Shift أثناء تشغيل التطبيق، أو مرّر ‎--spark-safe-mode، لتخطي استعادة النوافذ وإطاراتها المحفوظة.",
  yes: "نعم", no: "لا",
  secondLaunches: "عمليات التشغيل الثانية", noLaunches: "لا شيء بعد. شغّل التطبيق مرة أخرى، أو افتح به ملفًا أو رابطًا.",
  workingDirectory: "مجلد العمل", files: "الملفات", urls: "الروابط", none: "لا شيء",
  relaunch: "إعادة التشغيل", relaunchSafe: "إعادة التشغيل في الوضع الآمن", relaunchNormal: "إعادة التشغيل بشكل عادي",
  vetoQuit: "رفض طلبات الإغلاق", allowQuit: "إيقاف رفض الإغلاق",
  pending: "بانتظار قرار الإغلاق…", approved: "تمت الموافقة على الإغلاق؛ تتولى النسخة الجديدة.",
  vetoed: "رُفض الإغلاق؛ أُوقفت النسخة الجديدة.", failed: "فشلت إعادة التشغيل:",
};

export const LIFECYCLE_MESSAGES: Record<Locale, LifecycleMessages> = { en, ar };
export function useLifecycleMessages() { return LIFECYCLE_MESSAGES[useI18n().locale]; }
