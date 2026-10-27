import { defineScreens, lazyScreen } from "../../shell/registry";
import { Keyboard } from "./Keyboard";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("keyboard", [
  { id: "keyboard", title: "Keyboard monitor", titles: { ar: "مراقب لوحة المفاتيح" }, summary: "Key down/up events for the focused window, including natively consumed keys.", summaries: { ar: "أحداث ضغط المفاتيح وإفلاتها في النافذة النشطة، بما فيها المفاتيح التي يستهلكها النظام الأصلي." }, component: Keyboard },
  { id: "keyboard-controller", title: "Keyboard controller", titles: { ar: "متحكم لوحة المفاتيح" }, summary: "react-native-keyboard-controller on desktop: its provider, keyboard-aware scroll view and toolbar render without a software keyboard to avoid.", summaries: { ar: "‏react-native-keyboard-controller على سطح المكتب: يعرض المزوّد وعرض التمرير المدرك للوحة المفاتيح وشريط الأدوات دون لوحة مفاتيح برمجية يجب تجنبها." }, component: lazyScreen(() => require("./KeyboardControllerDemo").KeyboardControllerDemo) },
]);
