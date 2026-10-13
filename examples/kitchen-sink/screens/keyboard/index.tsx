import { defineScreens } from "../../shell/registry";
import { Keyboard } from "./Keyboard";
import { ShortcutMap } from "./ShortcutMap";
import { SHORTCUT_MAP_MESSAGES } from "./shortcut-map-messages";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("keyboard", [
  { id: "keyboard", title: "Keyboard monitor", titles: { ar: "مراقب لوحة المفاتيح" }, summary: "Key down/up events for the focused window, including natively consumed keys.", summaries: { ar: "أحداث ضغط المفاتيح وإفلاتها في النافذة النشطة، بما فيها المفاتيح التي يستهلكها النظام الأصلي." }, component: Keyboard },
  { id: "shortcut-map", title: "Shortcut map", titles: { ar: SHORTCUT_MAP_MESSAGES.ar.title }, summary: "User-editable command shortcuts: rebind, unbind and reset with persistence, live and menu updates, and conflicts across scopes.", summaries: { ar: "اختصارات أوامر يعدّلها المستخدم: إعادة التعيين والإلغاء والاستعادة مع الحفظ، والتحديث الفوري للاختصارات والقوائم، والتعارضات بين النطاقات." }, component: ShortcutMap },
]);
