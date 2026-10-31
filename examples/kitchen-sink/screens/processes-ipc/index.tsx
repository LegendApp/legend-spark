import { defineScreens, lazyScreen } from "../../shell/registry";

export default defineScreens("processes-ipc", [
  { id: "worklets-core", title: "Worklets Core", titles: { ar: "نوى Worklets" }, summary: "react-native-worklets-core on desktop: a worklet context running JavaScript on its own thread, shared values and calls back to the main runtime.", summaries: { ar: "‏react-native-worklets-core على سطح المكتب: سياق worklet يشغّل JavaScript على خيط خاص به، وقيم مشتركة، واستدعاءات تعود إلى بيئة التشغيل الرئيسية." }, component: lazyScreen(() => require("./WorkletsCoreDemo").WorkletsCoreDemo) },
]);
