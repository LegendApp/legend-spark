import { defineScreens } from "../../shell/registry";
import { Pointer } from "./Pointer";

export default defineScreens("pointer-trackpad", [
  { id: "pointer", title: "Pointer", titles: { ar: "المؤشر" }, summary: "Cursors, hiding the cursor while typing, trackpad gestures, Force Touch pressure, back and forward buttons, and haptic feedback.", summaries: { ar: "المؤشرات، وإخفاء المؤشر أثناء الكتابة، وإيماءات لوحة التتبع، وضغط Force Touch، وزرّا الرجوع والتقدّم، والاستجابة اللمسية." }, component: Pointer },
]);
