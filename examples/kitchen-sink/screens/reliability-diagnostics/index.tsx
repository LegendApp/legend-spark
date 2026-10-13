import { defineScreens } from "../../shell/registry";
import { CrashReporting } from "./CrashReporting";
import { HangWatchdog } from "./HangWatchdog";
import { Logging } from "./Logging";

export default defineScreens("reliability-diagnostics", [
  { id: "logging", title: "Logging", titles: { ar: "التسجيل" }, summary: "Structured entries to the unified log and rotating JSON-lines files; the newest entries; a diagnostics zip saved locally.", summaries: { ar: "إدخالات منظّمة في سجل النظام الموحّد وفي ملفات JSON-lines تُدوَّر؛ وأحدث الإدخالات؛ وملف zip للتشخيص يُحفظ محليًا." }, component: Logging },
  { id: "hang-watchdog", title: "Hang watchdog", titles: { ar: "مراقب التعليق" }, summary: "A watchdog thread reports main-thread hangs with their duration and a stack sampled during the hang; block the main thread for a chosen time to see one.", summaries: { ar: "يُبلغ خيط مراقبة عن تعليق الخيط الرئيسي ومدته ومكدّس استدعاءات يُلتقط أثناءه؛ احظر الخيط الرئيسي مدة تختارها لترى تعليقًا." }, component: HangWatchdog },
  { id: "crash-reporting", title: "Crash reporting", titles: { ar: "تقارير الانهيار" }, summary: "With the user's consent, native crashes and fatal JavaScript errors are recorded on this Mac and symbolicated; crash a helper process to see a report.", summaries: { ar: "بعد موافقة المستخدم، تُسجَّل الانهيارات الأصلية وأخطاء JavaScript القاتلة على هذا الـMac وتُترجم رموزها؛ اجعل عملية مساعدة تنهار لترى تقريرًا." }, component: CrashReporting },
]);
