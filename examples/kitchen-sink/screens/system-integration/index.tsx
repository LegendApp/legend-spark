import { defineScreens, lazyScreen } from "../../shell/registry";
import { DockTaskbar } from "./DockTaskbar";

export default defineScreens("system-integration", [
  { id: "dock", title: "Dock & taskbar", titles: { ar: "Dock وشريط المهام" }, summary: "App badge text and counts, Dock tile progress (normal, paused, error, indeterminate), attention requests, and the Dock menu or Jump List.", summaries: { ar: "نص شارة التطبيق وأعدادها، والتقدم على أيقونة Dock (عادي ومتوقف مؤقتًا وخطأ وغير محدد)، وطلبات التنبيه، وقائمة Dock أو قائمة الانتقال." }, component: DockTaskbar },
  { id: "keep-awake", title: "Keep awake", titles: { ar: "إبقاء الشاشة نشطة" }, summary: "expo-keep-awake on desktop: a power assertion that keeps the display and system awake while active, released on deactivate.", summaries: { ar: "‏expo-keep-awake على سطح المكتب: تأكيد طاقة يُبقي الشاشة والنظام نشطين أثناء التفعيل، ويُحرَّر عند الإلغاء." }, component: lazyScreen(() => require("./KeepAwakeDemo").KeepAwakeDemo) },
  { id: "expo-application", title: "Expo Application", titles: { ar: "تطبيق Expo" }, summary: "expo-application on desktop: bundle name, identifier and versions, installation time from the app bundle, and Mac answers for the iOS-only queries.", summaries: { ar: "‏expo-application على سطح المكتب: اسم الحزمة ومعرّفها وإصداراتها، ووقت التثبيت من حزمة التطبيق، وإجابات Mac عن الاستعلامات الخاصة بـ iOS." }, component: lazyScreen(() => require("./ExpoApplicationDemo").ExpoApplicationDemo) },
]);
