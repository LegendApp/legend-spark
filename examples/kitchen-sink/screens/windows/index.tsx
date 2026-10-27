import { defineScreens, lazyScreen } from "../../shell/registry";
import { WindowControls } from "./WindowControls";
import { WindowManager } from "./WindowManager";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("windows", [
  { id: "window-manager", title: "Window manager", titles: { ar: "مدير النوافذ" }, summary: "Open, resize, rename, blur (macOS) and close a child window; main window frame and focus events.", summaries: { ar: "فتح نافذة فرعية وتغيير حجمها وإعادة تسميتها وإزالة التركيز عنها (macOS) وإغلاقها؛ وإطار النافذة الرئيسية وأحداث التركيز." }, component: WindowManager },
  { id: "window-controls", title: "Window controls", titles: { ar: "أزرار التحكم في النافذة" }, summary: "Hide and show the macOS traffic lights; fullscreen state.", summaries: { ar: "إخفاء أزرار الإغلاق والتصغير والتكبير في macOS وإظهارها؛ وحالة ملء الشاشة." }, component: WindowControls },
  { id: "safe-area", title: "Safe area", titles: { ar: "المنطقة الآمنة" }, summary: "react-native-safe-area-context on desktop: provider frame and insets from the window's NSView, SafeAreaView padding and the insets hook.", summaries: { ar: "‏react-native-safe-area-context على سطح المكتب: إطار المزوّد والحواف من NSView للنافذة، وحشوة SafeAreaView وخطاف الحواف." }, component: lazyScreen(() => require("./SafeAreaDemo").SafeAreaDemo) },
]);
