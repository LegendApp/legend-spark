import { defineScreens } from "../../shell/registry";
import { DesktopChecks } from "./DesktopChecks";
import { LaunchState } from "./LaunchState";

export default defineScreens("infra", [
  { id: "desktop-checks", title: "Desktop checks", titles: { ar: "فحوص سطح المكتب" }, summary: "The original Kitchen Sink page: files, windows, dialogs, settings, menus, clipboard, links, secure storage, native UI and integrations.", summaries: { ar: "صفحة Kitchen Sink الأصلية: الملفات والنوافذ ومربعات الحوار والإعدادات والقوائم والحافظة والروابط والتخزين الآمن والواجهة الأصلية والتكاملات." }, component: DesktopChecks },
  { id: "launch-state", title: "Launch state", titles: { ar: "حالة التشغيل" }, summary: "What a launch found from earlier launches (a saved setting, a recent document, the main window frame), its launch arguments and the files opened since launch. Flows use it to check clearState.", summaries: { ar: "ما وجده التشغيل من تشغيلات سابقة (إعداد محفوظ، ومستند حديث، وإطار النافذة الرئيسية)، ووسائط التشغيل، والملفات المفتوحة منذ التشغيل. تستخدمها التدفقات لفحص clearState." }, component: LaunchState },
]);
