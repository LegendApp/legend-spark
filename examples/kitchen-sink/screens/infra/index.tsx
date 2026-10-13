import { defineScreens } from "../../shell/registry";
import { DesktopChecks } from "./DesktopChecks";
import { LaunchState } from "./LaunchState";
import { SignOff } from "./SignOff";

export default defineScreens("infra", [
  { id: "desktop-checks", title: "Desktop checks", titles: { ar: "فحوص سطح المكتب" }, summary: "The original Kitchen Sink page: files, windows, dialogs, settings, menus, clipboard, links, secure storage, native UI and integrations.", summaries: { ar: "صفحة Kitchen Sink الأصلية: الملفات والنوافذ ومربعات الحوار والإعدادات والقوائم والحافظة والروابط والتخزين الآمن والواجهة الأصلية والتكاملات." }, component: DesktopChecks },
  { id: "launch-state", title: "Launch state", titles: { ar: "حالة التشغيل" }, summary: "What a launch found from earlier launches (a saved setting, a recent document, the main window frame), its launch arguments and the files opened since launch. Flows use it to check clearState.", summaries: { ar: "ما وجده التشغيل من تشغيلات سابقة (إعداد محفوظ، ومستند حديث، وإطار النافذة الرئيسية)، ووسائط التشغيل، والملفات المفتوحة منذ التشغيل. تستخدمها التدفقات لفحص clearState." }, component: LaunchState },
  { id: "sign-off", title: "Manual sign-off", titles: { ar: "الاعتماد اليدوي" }, summary: "The checklist bun run gate:signoff opens: the manual steps of the last gate run, their in-process screenshots, and a pass or fail sign-off (a failure needs a note) that you confirm at the terminal.", summaries: { ar: "قائمة التحقق التي يفتحها bun run gate:signoff: الخطوات اليدوية لآخر تشغيل للبوابة، ولقطات الشاشة الملتقطة داخل العملية، واعتماد بالنجاح أو الفشل (يحتاج الفشل إلى ملاحظة) تؤكده في الطرفية." }, component: SignOff },
]);
