import { defineScreens } from "../../shell/registry";
import { OSIntegration } from "./OSIntegration";

export default defineScreens("files-filesystem", [
  { id: "os-integration", title: "File system APIs", titles: { ar: "واجهات نظام الملفات" }, summary: "Bookmarks across relaunch, Full Disk Access, coordination, open-with, icons, thumbnails, Quick Look, xattrs, quarantine, disk space and typed volume errors.", summaries: { ar: "إشارات مرجعية تبقى بعد إعادة التشغيل، والوصول الكامل إلى القرص، وتنسيق الملفات، والفتح باستخدام تطبيق، والأيقونات، والصور المصغّرة، وQuick Look، والسمات الموسّعة، والحجر، والمساحة على القرص، وأخطاء وحدات التخزين المصنّفة." }, component: OSIntegration },
]);
