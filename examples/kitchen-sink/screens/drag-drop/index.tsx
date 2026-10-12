import { defineScreens } from "../../shell/registry";
import { DragFeatures } from "./DragFeatures";

export default defineScreens("drag-drop", [
  { id: "features", title: "Drag features", summary: "Promised files for Finder, spring-loaded targets, custom drag images, and drag operations chosen by modifier keys.", component: DragFeatures },
]);
