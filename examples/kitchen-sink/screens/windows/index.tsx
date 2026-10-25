import { defineScreens } from "../../shell/registry";
import { WindowControls } from "./WindowControls";
import { WindowManager } from "./WindowManager";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("windows", [
  { id: "window-manager", title: "Window manager", titles: { ar: "مدير النوافذ" }, summary: "Open, resize, rename, blur (macOS) and close a child window; main window frame and focus events.", summaries: { ar: "فتح نافذة فرعية وتغيير حجمها وإعادة تسميتها وإزالة التركيز عنها (macOS) وإغلاقها؛ وإطار النافذة الرئيسية وأحداث التركيز." }, component: WindowManager },
  { id: "window-controls", title: "Window controls", titles: { ar: "أزرار التحكم في النافذة" }, summary: "Hide and show the macOS traffic lights; fullscreen state.", summaries: { ar: "إخفاء أزرار الإغلاق والتصغير والتكبير في macOS وإظهارها؛ وحالة ملء الشاشة." }, component: WindowControls },
]);
