import { defineScreens } from "../../shell/registry";
import { DesktopChecks } from "./DesktopChecks";

export default defineScreens("infra", [
  { id: "desktop-checks", title: "Desktop checks", summary: "The original Kitchen Sink page: files, windows, dialogs, settings, menus, clipboard, links, secure storage, native UI and integrations.", component: DesktopChecks },
]);
