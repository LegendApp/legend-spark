import { defineScreens } from "../../shell/registry";
import { Toolbar } from "./Toolbar";
import { WindowControls } from "./WindowControls";
import { WindowManager } from "./WindowManager";
import { WindowOptions } from "./WindowOptions";
import { WindowTabs } from "./WindowTabs";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("windows", [
  { id: "window-manager", title: "Window manager", titles: { ar: "مدير النوافذ" }, summary: "Open, resize, rename, blur (macOS) and close a child window; main window frame and focus events.", summaries: { ar: "فتح نافذة فرعية وتغيير حجمها وإعادة تسميتها وإزالة التركيز عنها (macOS) وإغلاقها؛ وإطار النافذة الرئيسية وأحداث التركيز." }, component: WindowManager },
  { id: "window-options", title: "Window options", titles: { ar: "خيارات النوافذ" }, summary: "Open a child window with options applied, then change each option from the Windows epic on the live window; per-option availability and rejected requests.", summaries: { ar: "فتح نافذة فرعية مع تطبيق خيارات عليها، ثم تغيير كل خيار من خيارات النوافذ في النافذة المفتوحة؛ مع توفّر كل خيار والطلبات المرفوضة." }, component: WindowOptions },
  { id: "window-tabs", title: "Window tabs", titles: { ar: "علامات تبويب النوافذ" }, summary: "Native macOS window tabs: a window type sharing one tabbing identifier, new tabs and the + button, select, merge, move to a new window, the tab bar, and a readout of tab groups and tab events.", summaries: { ar: "علامات تبويب النوافذ الأصلية في macOS: نوع نافذة يتشارك معرّف تبويب واحدًا، وعلامات تبويب جديدة وزر +، والتحديد والدمج والنقل إلى نافذة جديدة، وشريط علامات التبويب، وقراءة لمجموعات علامات التبويب وأحداثها." }, component: WindowTabs },
  { id: "window-controls", title: "Window controls", titles: { ar: "أزرار التحكم في النافذة" }, summary: "Hide and show the macOS traffic lights; fullscreen state.", summaries: { ar: "إخفاء أزرار الإغلاق والتصغير والتكبير في macOS وإظهارها؛ وحالة ملء الشاشة." }, component: WindowControls },
  { id: "toolbar", title: "Toolbar", titles: { ar: "شريط الأدوات" }, summary: "A child window's toolbar: display modes, show and hide, overflow in a narrow window, the sidebar item and a customizable, saved layout.", summaries: { ar: "شريط أدوات نافذة فرعية: أوضاع العرض، والإظهار والإخفاء، والفائض في نافذة ضيقة، وعنصر الشريط الجانبي، وتخطيط قابل للتخصيص ومحفوظ." }, component: Toolbar },
]);
