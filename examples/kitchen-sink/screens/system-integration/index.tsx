import { defineScreens } from "../../shell/registry";
import { DockTaskbar } from "./DockTaskbar";

export default defineScreens("system-integration", [
  { id: "dock", title: "Dock & taskbar", titles: { ar: "Dock وشريط المهام" }, summary: "App badge text and counts, Dock tile progress (normal, paused, error, indeterminate), attention requests, and the Dock menu or Jump List.", summaries: { ar: "نص شارة التطبيق وأعدادها، والتقدم على أيقونة Dock (عادي ومتوقف مؤقتًا وخطأ وغير محدد)، وطلبات التنبيه، وقائمة Dock أو قائمة الانتقال." }, component: DockTaskbar },
]);
