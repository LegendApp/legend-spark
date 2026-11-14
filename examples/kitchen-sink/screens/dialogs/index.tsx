import { defineScreens, lazyScreen } from "../../shell/registry";
import { Panels } from "./Panels";

export default defineScreens("dialogs", [
  { id: "panels", title: "Dialog features", titles: { ar: "ميزات مربعات الحوار" }, summary: "Open/save accessory controls, a \"Don't ask again\" checkbox, plain and secure text prompts, confirm, and the standard About panel with overrides.", summaries: { ar: "عناصر إضافية في لوحتي الفتح والحفظ، وخانة «عدم السؤال مرة أخرى»، وطلبات إدخال نص عادي وسرّي، والتأكيد، ولوحة «حول» القياسية مع تخصيصها." }, component: Panels },
  { id: "expo-document-picker", title: "Expo Document Picker", titles: { ar: "منتقي مستندات Expo" }, summary: "Open documents with Expo results and cache copies.", summaries: { ar: "فتح المستندات بنتائج Expo ونسخها إلى ذاكرة التخزين المؤقت." }, component: lazyScreen(() => require("./ExpoDocumentPickerScreen").ExpoDocumentPickerScreen) },
]);
