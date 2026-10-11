import { defineScreens } from "../../shell/registry";
import { Panels } from "./Panels";

export default defineScreens("dialogs", [
  { id: "panels", title: "Dialog features", summary: "Open/save accessory controls, a \"Don't ask again\" checkbox, plain and secure text prompts, confirm, and the standard About panel with overrides.", component: Panels },
]);
