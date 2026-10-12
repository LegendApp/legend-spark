import { defineScreens } from "../../shell/registry";
import { CrashReporting } from "./CrashReporting";
import { HangWatchdog } from "./HangWatchdog";
import { Logging } from "./Logging";

export default defineScreens("reliability-diagnostics", [
  { id: "logging", title: "Logging", summary: "Structured entries to the unified log and rotating JSON-lines files; the newest entries; a diagnostics zip saved locally.", component: Logging },
  { id: "hang-watchdog", title: "Hang watchdog", summary: "A watchdog thread reports main-thread hangs with their duration and a stack sampled during the hang; block the main thread for a chosen time to see one.", component: HangWatchdog },
  { id: "crash-reporting", title: "Crash reporting", summary: "With the user's consent, native crashes and fatal JavaScript errors are recorded on this Mac and symbolicated; crash a helper process to see a report.", component: CrashReporting },
]);
