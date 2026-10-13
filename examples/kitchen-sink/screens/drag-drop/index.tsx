import { defineScreens } from "../../shell/registry";
import { DragFeatures } from "./DragFeatures";

export default defineScreens("drag-drop", [
  { id: "features", title: "Drag features", titles: { ar: "ميزات السحب" }, summary: "Promised files for Finder, spring-loaded targets, custom drag images, and drag operations chosen by modifier keys.", summaries: { ar: "ملفات موعودة لـ Finder، وأهداف تُفتح بالفتح النابض، وصور سحب مخصصة، وعمليات سحب تختارها مفاتيح التعديل." }, component: DragFeatures },
]);
