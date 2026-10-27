import { defineScreens } from "../../shell/registry";
import { ScreensDemo } from "./ScreensDemo";

export default defineScreens("component-library", [
  { id: "screens", title: "Screens", titles: { ar: "شاشات التنقل" }, summary: "react-native-screens on desktop: Screen, ScreenContainer and ScreenStack render as plain views, showing the active screen and hiding inactive ones.", summaries: { ar: "‏react-native-screens على سطح المكتب: تُعرض Screen وScreenContainer وScreenStack كعروض عادية، فتظهر الشاشة النشطة وتُخفى غير النشطة." }, component: ScreensDemo },
]);
