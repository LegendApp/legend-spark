import { defineScreens } from "../../shell/registry";
import { ReleaseProfilerDemo } from "./ReleaseProfilerDemo";
import { AppLogsDemo } from "./AppLogsDemo";

export default defineScreens("devtools", [
  { id: "release-profiler", title: "Release profiler", titles: { ar: "محلل الإصدار" }, summary: "react-native-release-profiler on desktop: Hermes sampling profiler start and stop, writing a .cpuprofile trace to the app's own Caches folder.", summaries: { ar: "‏react-native-release-profiler على سطح المكتب: بدء محلل العينات في Hermes وإيقافه، مع كتابة ملف ‎.cpuprofile في مجلد Caches الخاص بالتطبيق." }, component: ReleaseProfilerDemo },
  { id: "app-logs", title: "App logs", titles: { ar: "سجلات التطبيق" }, summary: "react-native-app-logs on desktop: the app's own unified-log entries from OSLogStore, filtered and delivered to JavaScript.", summaries: { ar: "‏react-native-app-logs على سطح المكتب: إدخالات السجل الموحد الخاصة بالتطبيق من OSLogStore، مُرشَّحة ومُسلَّمة إلى JavaScript." }, component: AppLogsDemo },
]);
