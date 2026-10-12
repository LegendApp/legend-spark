import { defineScreens } from "../../shell/registry";
import { Logging } from "./Logging";

export default defineScreens("reliability-diagnostics", [
  { id: "logging", title: "Logging", summary: "Structured entries to the unified log and rotating JSON-lines files; the newest entries; a diagnostics zip saved locally.", component: Logging },
]);
