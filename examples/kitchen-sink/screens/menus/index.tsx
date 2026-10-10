import { defineScreens } from "../../shell/registry";
import { MenuAudit } from "./MenuAudit";

export default defineScreens("menus", [
  { id: "audit", title: "Application menu audit", summary: "Alternates, open/close events, Help search, mixed state, hidden items and SF Symbols, with per-platform availability.", component: MenuAudit },
]);
