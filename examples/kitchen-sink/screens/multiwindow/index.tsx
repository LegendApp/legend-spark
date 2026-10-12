import { defineScreens } from "../../shell/registry";
import { Multiwindow } from "./Multiwindow";

export default defineScreens("multiwindow", [
  { id: "windows", title: "Multiwindow", summary: "Window types, a single Settings window, a document shared live across windows, per-window state with promotion, and per-window error isolation.", component: Multiwindow },
]);
