import { defineScreens } from "../../shell/registry";
import { TextServices } from "./TextServices";

export default defineScreens("text-input-editing", [
  { id: "text-services", title: "Text services", titles: { ar: "خدمات النص" }, summary: "Services and Look Up on a selection, Writing Tools per input, and the native find bar with match count, case and wrap.", summaries: { ar: "الخدمات والبحث عن التعريف للنص المحدد، وأدوات الكتابة لكل حقل، وشريط البحث الأصلي مع عدد التطابقات ومطابقة حالة الأحرف والالتفاف." }, component: TextServices },
]);
