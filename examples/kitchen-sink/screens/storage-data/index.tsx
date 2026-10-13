import { defineScreens } from "../../shell/registry";
import { Biometrics } from "./Biometrics";
import { BIOMETRICS_MESSAGES } from "./biometrics-messages";

export default defineScreens("storage-data", [
  { id: "biometrics", title: "Biometrics", titles: { ar: BIOMETRICS_MESSAGES.ar.title }, summary: "Touch ID availability and status, prompts with each fallback policy (Touch ID only, the login password, the app's own sign-in), cancelling a prompt, and Keychain secrets gated by biometry.", summaries: { ar: "توفّر Touch ID وحالته، وطلبات التحقق بكل سياسة بديلة (Touch ID وحده، أو كلمة سر الدخول، أو تسجيل الدخول الخاص بالتطبيق)، وإلغاء الطلب، وأسرار سلسلة المفاتيح المحمية بالقياسات الحيوية." }, component: Biometrics },
]);
