import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";

// Strings for the Sign in with Apple and passkeys screen. Availability and results are API data, so flows can assert
// them in any locale; they are not translated.
export type SignInMessages = {
  title: string; intro: string; availability: string; apple: string; passkeys: string;
  appleAvailability: string; passkeyAvailability: string; refresh: string;
  signIn: string; credentialState: string; create: string; assert: string; cancel: string;
  noResult: string; noUser: string; relyingParty: string; driver: string;
  featureAvailability: string; more: string; securityKeyCreate: string; securityKeyGet: string; extensionsCreate: string; extensionsGet: string;
  immediate: string; combined: string; signal: string;
};

const en: SignInMessages = {
  title: "Sign in with Apple and passkeys",
  intro: "Both need entitlements only a build signed by its team can carry; this build has none, so real requests stop with missingEntitlement before anything is shown.",
  availability: "Availability", apple: "Sign in with Apple", passkeys: "Passkeys",
  appleAvailability: "Sign in with Apple", passkeyAvailability: "Passkeys for", refresh: "Refresh",
  signIn: "Sign in", credentialState: "Credential state", create: "Create passkey", assert: "Sign in with passkey", cancel: "Cancel request",
  noResult: "No result yet.", noUser: "Sign in first.", relyingParty: "Relying party",
  driver: "In a test-driver run requests are simulated: nothing is presented and neither Apple nor a relying party is reached.",
  featureAvailability: "Passkey features on this Mac", more: "Security keys, extensions and combined sign-in",
  securityKeyCreate: "Create on security key", securityKeyGet: "Passkey or security key", extensionsCreate: "Create with PRF and blob",
  extensionsGet: "Sign in with PRF and blob", immediate: "Sign in if on this Mac", combined: "Passkey or Apple", signal: "Signal unknown passkey",
};

const ar: SignInMessages = {
  title: "تسجيل الدخول باستخدام Apple ومفاتيح المرور",
  intro: "يحتاج كلاهما إلى استحقاقات لا يحملها إلا إصدار موقَّع من فريقه؛ هذا الإصدار بلا استحقاقات، فتتوقف الطلبات الحقيقية عند missingEntitlement قبل أن يظهر أي شيء.",
  availability: "التوفر", apple: "تسجيل الدخول باستخدام Apple", passkeys: "مفاتيح المرور",
  appleAvailability: "تسجيل الدخول باستخدام Apple", passkeyAvailability: "مفاتيح المرور لـ", refresh: "تحديث",
  signIn: "تسجيل الدخول", credentialState: "حالة بيانات الاعتماد", create: "إنشاء مفتاح مرور", assert: "الدخول بمفتاح مرور", cancel: "إلغاء الطلب",
  noResult: "لا نتيجة بعد.", noUser: "سجّل الدخول أولًا.", relyingParty: "الطرف المعتمد",
  driver: "في تشغيل برنامج الاختبار تكون الطلبات محاكاة: لا يُعرض شيء ولا يُتصل بـ Apple أو بالطرف المعتمد.",
  featureAvailability: "ميزات مفاتيح المرور على هذا الـ Mac", more: "مفاتيح الأمان والإضافات وتسجيل الدخول المجمّع",
  securityKeyCreate: "إنشاء على مفتاح أمان", securityKeyGet: "مفتاح مرور أو مفتاح أمان", extensionsCreate: "إنشاء مع PRF وكتلة",
  extensionsGet: "الدخول مع PRF وكتلة", immediate: "الدخول إن كان على هذا الـ Mac", combined: "مفتاح مرور أو Apple", signal: "إبلاغ عن مفتاح مجهول",
};

export const SIGN_IN_MESSAGES: Record<Locale, SignInMessages> = { en, ar };
export function useSignInMessages() { return SIGN_IN_MESSAGES[useI18n().locale]; }
