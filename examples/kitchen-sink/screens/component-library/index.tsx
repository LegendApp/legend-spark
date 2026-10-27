import { defineScreens } from "../../shell/registry";
import { ScreensDemo } from "./ScreensDemo";
import { ReanimatedDemo } from "./ReanimatedDemo";

export default defineScreens("component-library", [
  { id: "screens", title: "Screens", titles: { ar: "شاشات التنقل" }, summary: "react-native-screens on desktop: Screen, ScreenContainer and ScreenStack render as plain views, showing the active screen and hiding inactive ones.", summaries: { ar: "‏react-native-screens على سطح المكتب: تُعرض Screen وScreenContainer وScreenStack كعروض عادية، فتظهر الشاشة النشطة وتُخفى غير النشطة." }, component: ScreensDemo },
  { id: "reanimated", title: "Reanimated", titles: { ar: "الحركة مع Reanimated" }, summary: "react-native-reanimated and react-native-worklets on desktop: a timing animation driven on the UI thread, frame callbacks and an animated style.", summaries: { ar: "‏react-native-reanimated وreact-native-worklets على سطح المكتب: حركة توقيت تُدار على خيط الواجهة، واستدعاءات الإطارات، ونمط متحرك." }, component: ReanimatedDemo },
]);
