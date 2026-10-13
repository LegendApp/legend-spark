import { defineScreens } from "../../shell/registry";
import { ReactDevTools } from "./ReactDevTools";
import { DeveloperMenu } from "./DeveloperMenu";
import { DEVELOPER_MENU_MESSAGES } from "./developer-menu-messages";
import { DevTools } from "./DevTools";
import { DEVTOOLS_MESSAGES } from "./devtools-messages";
import { Network } from "./Network";
import { NETWORK_MESSAGES } from "./network-messages";
import { Profiling } from "./Profiling";
import { PROFILING_MESSAGES } from "./profiling-messages";
import { REACT_DEVTOOLS_MESSAGES } from "./react-devtools-messages";

export default defineScreens("devtools", [
  { id: "devtools", title: "React Native DevTools", titles: { ar: DEVTOOLS_MESSAGES.ar.title }, summary: "The Hermes debugger per JavaScript runtime: breakpoints, console, sources with source maps, pause on exceptions; ⌥⌘I.", summaries: { ar: "مصحّح Hermes لكل بيئة تشغيل JavaScript: نقاط التوقف ووحدة التحكم والمصادر مع خرائط المصادر والإيقاف عند الاستثناءات؛ ⌥⌘I." }, component: DevTools },
  { id: "network", title: "Network inspector", titles: { ar: NETWORK_MESSAGES.ar.title }, summary: "fetch, XMLHttpRequest and WebSocket traffic in React Native DevTools' Network panel, with redacted headers and size-capped bodies (development builds).", summaries: { ar: "حركة fetch وXMLHttpRequest وWebSocket في لوحة Network ضمن أدوات مطوّري React Native، مع ترويسات محجوبة وأجسام محدودة الحجم (نسخ التطوير)." }, component: Network },
  { id: "profiling", title: "Profiling", titles: { ar: PROFILING_MESSAGES.ar.title }, summary: "Hermes sampling profiles of every JavaScript runtime, source-mapped, and a frame timeline of main-thread frames and motion as a Chrome trace; heap snapshots in DevTools (development builds).", summaries: { ar: "تحليلات Hermes بالعيّنات لكل بيئات تشغيل JavaScript مربوطة بالمصادر، وخط زمني لإطارات الخيط الرئيسي والحركة في ملف تتبّع Chrome؛ ولقطات الذاكرة في أدوات المطوّر (نسخ التطوير)." }, component: Profiling },
  { id: "dev-menu", title: "Developer menu", titles: { ar: DEVELOPER_MENU_MESSAGES.ar.title }, summary: "The development-only Developer menu: Reload, DevTools, Element Inspector, Performance Monitor, Fast Refresh and bundle info for the key window's runtime.", summaries: { ar: "قائمة «المطوّر» الخاصة بنسخ التطوير: إعادة التحميل وأدوات المطوّر وفاحص العناصر ومراقب الأداء وFast Refresh ومعلومات الحزمة لبيئة تشغيل النافذة النشطة." }, component: DeveloperMenu },
  { id: "react-devtools", title: "React DevTools", titles: { ar: REACT_DEVTOOLS_MESSAGES.ar.title }, summary: "The Components and Profiler panels per JavaScript runtime: component tree, props, state and hooks, select element in any window, highlight updates, commit timings (development builds).", summaries: { ar: "لوحتا Components وProfiler لكل بيئة تشغيل JavaScript: شجرة المكوّنات والخصائص والحالة والخطافات، وتحديد عنصر في أي نافذة، وإبراز التحديثات، وتوقيت كل إيداع (نسخ التطوير)." }, component: ReactDevTools },
]);
