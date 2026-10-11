import { defineScreens } from "../../shell/registry";
import { DesktopChecks } from "./DesktopChecks";
import { LaunchState } from "./LaunchState";
import { SignOff } from "./SignOff";

export default defineScreens("infra", [
  { id: "desktop-checks", title: "Desktop checks", summary: "The original Kitchen Sink page: files, windows, dialogs, settings, menus, clipboard, links, secure storage, native UI and integrations.", component: DesktopChecks },
  { id: "launch-state", title: "Launch state", summary: "What a launch found from earlier launches (a saved setting, a recent document, the main window frame), its launch arguments and the files opened since launch. Flows use it to check clearState.", component: LaunchState },
  { id: "sign-off", title: "Manual sign-off", summary: "The checklist bun run gate:signoff opens: the manual steps of the last gate run, their in-process screenshots, and a pass or fail sign-off (a failure needs a note) that you confirm at the terminal.", component: SignOff },
]);
