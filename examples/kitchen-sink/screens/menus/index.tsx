import { defineScreens } from "../../shell/registry";
import { MenuAudit } from "./MenuAudit";

export default defineScreens("menus", [
  { id: "audit", title: "Application menu audit", titles: { ar: "تدقيق قوائم التطبيق" }, summary: "Alternates, open/close events, Help search, mixed state, hidden items and SF Symbols, with per-platform availability.", summaries: { ar: "العناصر البديلة، وأحداث الفتح والإغلاق، والبحث في «مساعدة»، والحالة المختلطة، والعناصر المخفية، ورموز SF، مع التوفّر على كل منصة." }, component: MenuAudit },
]);
