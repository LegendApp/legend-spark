import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the privileged helper screen. Availability, statuses and results are API data, so flows can assert them in
// any locale; they are not translated.
export type PrivilegedHelperMessages = {
  title: string; intro: string; availability: string; refresh: string;
  helper: string; status: string; register: string; unregister: string; openSettings: string;
  admin: string; authorize: string; release: string; held: string; notHeld: string;
  messages: string; send: string; sendAuthorized: string; noResult: string; driver: string;
};

const en: PrivilegedHelperMessages = {
  title: "Privileged helper, admin prompt and XPC",
  intro: "A launch daemon the app registers with launchd, the system admin prompt, and XPC messages that each side checks against the other's code signature. This build is not signed by a team and embeds no helper, so it reports unsigned and notFound.",
  availability: "Availability", refresh: "Refresh",
  helper: "Helper", status: "Status", register: "Register", unregister: "Unregister", openSettings: "Open Login Items",
  admin: "Admin prompt", authorize: "Request admin rights", release: "Release rights", held: "Admin rights held.", notHeld: "No admin rights held.",
  messages: "XPC messages", send: "Send whoami", sendAuthorized: "Send with admin rights", noResult: "No result yet.",
  driver: "In a test-driver run everything is simulated: nothing is registered with launchd, no prompt is shown and nothing runs as root.",
};

const ar: PrivilegedHelperMessages = {
  title: "المساعد ذو الصلاحيات ونافذة المسؤول وXPC",
  intro: "برنامج خفي يسجّله التطبيق لدى launchd، ونافذة المسؤول في النظام، ورسائل XPC يتحقق فيها كل طرف من توقيع الطرف الآخر. هذا الإصدار غير موقَّع من فريق ولا يضم مساعدًا، فيُبلغ عن unsigned وnotFound.",
  availability: "التوفر", refresh: "تحديث",
  helper: "المساعد", status: "الحالة", register: "تسجيل", unregister: "إلغاء التسجيل", openSettings: "فتح عناصر تسجيل الدخول",
  admin: "نافذة المسؤول", authorize: "طلب صلاحيات المسؤول", release: "التخلي عن الصلاحيات", held: "صلاحيات المسؤول محفوظة.", notHeld: "لا صلاحيات مسؤول محفوظة.",
  messages: "رسائل XPC", send: "إرسال whoami", sendAuthorized: "إرسال مع صلاحيات المسؤول", noResult: "لا نتيجة بعد.",
  driver: "في تشغيل برنامج الاختبار يكون كل شيء محاكاة: لا يُسجَّل شيء لدى launchd ولا تظهر نافذة ولا يعمل شيء بصلاحيات الجذر.",
};

export const PRIVILEGED_HELPER_MESSAGES: Record<Locale, PrivilegedHelperMessages> = { en, ar };
export function usePrivilegedHelperMessages() { return PRIVILEGED_HELPER_MESSAGES[useI18n().locale]; }
