import { defineScreens } from "../../shell/registry";
import { ReleaseProfilerDemo } from "./ReleaseProfilerDemo";

export default defineScreens("devtools", [
  { id: "release-profiler", title: "Release profiler", titles: { ar: "محلل الإصدار" }, summary: "react-native-release-profiler on desktop: Hermes sampling profiler start and stop, writing a .cpuprofile trace to the app's own Caches folder.", summaries: { ar: "‏react-native-release-profiler على سطح المكتب: بدء محلل العينات في Hermes وإيقافه، مع كتابة ملف ‎.cpuprofile في مجلد Caches الخاص بالتطبيق." }, component: ReleaseProfilerDemo },
]);
