import { defineScreens } from "../../shell/registry";
import { Panels } from "./Panels";

export default defineScreens("dialogs", [
  { id: "panels", title: "Dialog features", titles: { ar: "ميزات مربعات الحوار" }, summary: "Open/save accessory controls, a \"Don't ask again\" checkbox, plain and secure text prompts, confirm, and the standard About panel with overrides.", summaries: { ar: "عناصر إضافية في لوحتي الفتح والحفظ، وخانة «عدم السؤال مرة أخرى»، وطلبات إدخال نص عادي وسرّي، والتأكيد، ولوحة «حول» القياسية مع تخصيصها." }, component: Panels },
]);
