import { defineScreens } from "../../shell/registry";
import { ClipboardData } from "./ClipboardData";

export default defineScreens("clipboard", [
  { id: "data", title: "Promised data & changes", summary: "Promised (lazy) clipboard data, change monitoring, concealed and transient markers, and rich reads and writes.", component: ClipboardData },
]);
