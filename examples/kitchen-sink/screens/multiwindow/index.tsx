import { defineScreens } from "../../shell/registry";
import { Choreography } from "./Choreography";
import { CHOREOGRAPHY_MESSAGES } from "./choreography-messages";
import { Multiwindow } from "./Multiwindow";
import { Performance } from "./Performance";
import { PERFORMANCE_MESSAGES } from "./performance-messages";
import { SpecialWindows } from "./SpecialWindows";

export default defineScreens("multiwindow", [
  { id: "windows", title: "Multiwindow", titles: { ar: "النوافذ المتعددة" }, summary: "Window types, a single Settings window, a document shared live across windows, per-window state with promotion, and per-window error isolation.", summaries: { ar: "أنواع النوافذ، ونافذة إعدادات واحدة، ومستند مشترك مباشرةً بين النوافذ، وحالة لكل نافذة مع ترقيتها، وعزل الأخطاء لكل نافذة." }, component: Multiwindow },
  { id: "special-windows", title: "Special windows", titles: { ar: "النوافذ الخاصة" }, summary: "A Spotlight-style command bar on a global hotkey, a HUD, a Quick Look-style preview, picture in picture with corner snapping, notch and menu bar popovers, an edge drawer, a click-through overlay, a desktop widget and presenter mode, with each window's state and bounds.", summaries: { ar: "شريط أوامر بأسلوب Spotlight باختصار عام، ولوحة HUD، ومعاينة بأسلوب Quick Look، وصورة داخل صورة تلتصق بالزوايا، ونوافذ منبثقة من الشق ومن شريط القوائم، ودرج على الحافة، وطبقة تمرّر النقرات، وأداة على سطح المكتب، ووضع العرض، مع حالة كل نافذة وحدودها." }, component: SpecialWindows },
  { id: "performance", title: "Window performance", titles: { ar: PERFORMANCE_MESSAGES.ar.title }, summary: "Prewarmed and pooled windows with a measured first paint, a per-type memory budget that memory pressure empties, and a clock window whose rendering stops while it is hidden.", summaries: { ar: "نوافذ مجهّزة مسبقًا في مجمّعات مع قياس أول رسم، وميزانية ذاكرة لكل نوع يفرّغها الضغط على الذاكرة، ونافذة ساعة يتوقف عرضها ما دامت مخفية." }, component: Performance },
  { id: "choreography", title: "Window choreography", titles: { ar: CHOREOGRAPHY_MESSAGES.ar.title }, summary: "A detail window that zooms out of a list row and shrinks back into it, compact and full sizes and Settings pane resizes, a panel torn off into a window and merged back, and an inspector and a palette docked to the main window.", summaries: { ar: "نافذة تفاصيل تتكبّر من صف في قائمة وتتقلص عائدةً إليه، والحجمان المضغوط والكامل وتغيّر حجم أجزاء الإعدادات، ولوحة تُفصل في نافذة ثم تُدمج من جديد، ومفتش ولوحة أدوات ملحقان بالنافذة الرئيسية." }, component: Choreography },
]);
