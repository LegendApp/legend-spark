import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";
import type { BiometricFallback, BiometricSecretAccess } from "@legendapp/spark/biometrics";

// Strings for the Biometrics screen. Status, results and availability are API data, so flows can assert them in any
// locale; they are not translated.
export type BiometricsMessages = {
  title: string; intro: string; status: string; authenticate: string; secrets: string;
  refresh: string; prompt: string; cancel: string; store: string; read: string; remove: string;
  reading: string; prompting: string; noResult: string; driver: string;
  fallbacks: Record<BiometricFallback, string>; accesses: Record<BiometricSecretAccess, string>;
};

const en: BiometricsMessages = {
  title: "Biometrics",
  intro: "Touch ID as macOS reports it. Opening this screen only reads the status; Prompt asks for Touch ID with the fallback named on its row, and the secrets are Keychain items only biometrics (or, for the last, the login password) can read.",
  status: "Status", authenticate: "Authenticate", secrets: "Secrets gated by biometry",
  refresh: "Refresh", prompt: "Prompt", cancel: "Cancel prompt", store: "Store", read: "Read", remove: "Delete",
  reading: "Reading…", prompting: "Waiting for the person…", noResult: "No result yet.",
  driver: "In a test-driver run biometrics are simulated: no Touch ID or password prompt appears and no keychain is touched.",
  fallbacks: { none: "Touch ID only", password: "Touch ID or the login password", app: "Touch ID or the app's own sign-in" },
  accesses: { biometryCurrentSet: "Fingerprints enrolled now", biometryAny: "Any enrolled fingerprint", biometryOrPassword: "Touch ID or the login password" },
};

const ar: BiometricsMessages = {
  title: "القياسات الحيوية",
  intro: "Touch ID كما يبلغ عنه macOS. فتح هذه الشاشة يقرأ الحالة فقط؛ «طلب» يطلب Touch ID مع البديل المذكور في صفه، والأسرار عناصر في سلسلة المفاتيح لا تقرؤها إلا القياسات الحيوية (أو كلمة سر الدخول للأخير).",
  status: "الحالة", authenticate: "المصادقة", secrets: "أسرار محمية بالقياسات الحيوية",
  refresh: "تحديث", prompt: "طلب", cancel: "إلغاء الطلب", store: "حفظ", read: "قراءة", remove: "حذف",
  reading: "جارٍ القراءة…", prompting: "بانتظار المستخدم…", noResult: "لا نتيجة بعد.",
  driver: "في تشغيل برنامج الاختبار تكون القياسات الحيوية محاكاة: لا تظهر نافذة Touch ID أو كلمة سر ولا تُستخدم سلسلة المفاتيح.",
  fallbacks: { none: "Touch ID فقط", password: "Touch ID أو كلمة سر الدخول", app: "Touch ID أو تسجيل الدخول الخاص بالتطبيق" },
  accesses: { biometryCurrentSet: "البصمات المسجلة الآن", biometryAny: "أي بصمة مسجلة", biometryOrPassword: "Touch ID أو كلمة سر الدخول" },
};

export const BIOMETRICS_MESSAGES: Record<Locale, BiometricsMessages> = { en, ar };
export function useBiometricsMessages() { return BIOMETRICS_MESSAGES[useI18n().locale]; }
