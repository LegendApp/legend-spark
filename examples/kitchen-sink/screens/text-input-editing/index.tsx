import { defineScreens } from "../../shell/registry";
import { TextServices } from "./TextServices";

export default defineScreens("text-input-editing", [
  { id: "text-services", title: "Text services", summary: "Services and Look Up on a selection, Writing Tools per input, and the native find bar with match count, case and wrap.", component: TextServices },
]);
