import { defineScreens } from "../../shell/registry";
import { ClipboardData } from "./ClipboardData";

export default defineScreens("clipboard", [
  { id: "data", title: "Promised data & changes", titles: { ar: "البيانات الموعودة والتغييرات" }, summary: "Promised (lazy) clipboard data, change monitoring, concealed and transient markers, and rich reads and writes.", summaries: { ar: "بيانات الحافظة الموعودة (المؤجّلة)، ومراقبة التغييرات، وعلامتا البيانات المخفية والمؤقتة، والقراءة والكتابة بتنسيقات غنية." }, component: ClipboardData },
]);
