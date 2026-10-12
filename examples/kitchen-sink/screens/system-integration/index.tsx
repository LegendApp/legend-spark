import { defineScreens } from "../../shell/registry";
import { DockTaskbar } from "./DockTaskbar";

export default defineScreens("system-integration", [
  { id: "dock", title: "Dock & taskbar", titles: { ar: "Dock وشريط المهام" }, summary: "App badge text and counts, Dock tile and taskbar progress (normal, paused, error, indeterminate), attention requests, and the Dock menu or Jump List with recent items.", summaries: { ar: "نص شارة التطبيق وأعدادها، والتقدم على أيقونة Dock وشريط المهام (عادي ومتوقف مؤقتًا وخطأ وغير محدد)، وطلبات التنبيه، وقائمة Dock أو قائمة الانتقال مع العناصر الأخيرة." }, component: DockTaskbar },
]);
