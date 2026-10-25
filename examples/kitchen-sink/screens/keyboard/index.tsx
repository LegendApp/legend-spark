import { defineScreens } from "../../shell/registry";
import { Keyboard } from "./Keyboard";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("keyboard", [
  { id: "keyboard", title: "Keyboard monitor", titles: { ar: "مراقب لوحة المفاتيح" }, summary: "Key down/up events for the focused window, including natively consumed keys.", summaries: { ar: "أحداث ضغط المفاتيح وإفلاتها في النافذة النشطة، بما فيها المفاتيح التي يستهلكها النظام الأصلي." }, component: Keyboard },
]);
