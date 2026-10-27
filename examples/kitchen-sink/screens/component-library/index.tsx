import { defineScreens } from "../../shell/registry";
import { ScreensDemo } from "./ScreensDemo";
import { ReanimatedDemo } from "./ReanimatedDemo";
import { GestureHandlerDemo } from "./GestureHandlerDemo";
import { NavigationDemo } from "./NavigationDemo";

export default defineScreens("component-library", [
  { id: "screens", title: "Screens", titles: { ar: "شاشات التنقل" }, summary: "react-native-screens on desktop: Screen, ScreenContainer and ScreenStack render as plain views, showing the active screen and hiding inactive ones.", summaries: { ar: "‏react-native-screens على سطح المكتب: تُعرض Screen وScreenContainer وScreenStack كعروض عادية، فتظهر الشاشة النشطة وتُخفى غير النشطة." }, component: ScreensDemo },
  { id: "reanimated", title: "Reanimated", titles: { ar: "الحركة مع Reanimated" }, summary: "react-native-reanimated and react-native-worklets on desktop: a timing animation driven on the UI thread, frame callbacks and an animated style.", summaries: { ar: "‏react-native-reanimated وreact-native-worklets على سطح المكتب: حركة توقيت تُدار على خيط الواجهة، واستدعاءات الإطارات، ونمط متحرك." }, component: ReanimatedDemo },
  { id: "gesture-handler", title: "Gesture handler", titles: { ar: "معالج الإيماءات" }, summary: "react-native-gesture-handler on desktop: the native module and button component, a root view, and tap and pan gestures driven by the mouse or trackpad.", summaries: { ar: "‏react-native-gesture-handler على سطح المكتب: الوحدة الأصلية ومكوّن الزر وعرض الجذر، وإيماءات النقر والسحب بالفأرة أو لوحة التتبع." }, component: GestureHandlerDemo },
  { id: "navigation", title: "React Navigation", titles: { ar: "التنقل مع React Navigation" }, summary: "React Navigation on desktop: a native stack with headers and back navigation, and bottom tabs, on top of react-native-screens and safe-area-context.", summaries: { ar: "‏React Navigation على سطح المكتب: مكدس أصلي مع ترويسات ورجوع، وعلامات تبويب سفلية، فوق react-native-screens وsafe-area-context." }, component: NavigationDemo },
]);
