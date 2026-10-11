import { defineScreens } from "../../shell/registry";
import { OSIntegration } from "./OSIntegration";

export default defineScreens("files-filesystem", [
  { id: "os-integration", title: "File system APIs", summary: "Bookmarks across relaunch, Full Disk Access, coordination, open-with, icons, thumbnails, Quick Look, xattrs, quarantine, disk space and typed volume errors.", component: OSIntegration },
]);
