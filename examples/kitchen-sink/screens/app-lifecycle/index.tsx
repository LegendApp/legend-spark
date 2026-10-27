import { defineScreens, lazyScreen } from "../../shell/registry";
import { LaunchInstance } from "./LaunchInstance";
import { LIFECYCLE_MESSAGES } from "./lifecycle-messages";

export default defineScreens("app-lifecycle", [
  { id: "launch", title: "Launch & single instance", titles: { ar: LIFECYCLE_MESSAGES.ar.title }, summary: "Single-instance status, forwarded second launches (arguments, files, URLs), relaunch with a quit veto, and safe mode.", summaries: { ar: "حالة النسخة الواحدة، والتشغيلات الثانية المُمرَّرة إليها (الوسائط والملفات والروابط)، وإعادة التشغيل مع رفض الإنهاء، والوضع الآمن." }, component: LaunchInstance },
  { id: "splash-screen", title: "Splash screen", titles: { ar: "شاشة البداية" }, summary: "expo-splash-screen on desktop: its API resolves without effect, since a desktop app has no launch splash.", summaries: { ar: "‏expo-splash-screen على سطح المكتب: تكتمل واجهته البرمجية دون أثر، إذ لا توجد شاشة بداية لتطبيق سطح المكتب." }, component: lazyScreen(() => require("./SplashScreenDemo").SplashScreenDemo) },
]);
