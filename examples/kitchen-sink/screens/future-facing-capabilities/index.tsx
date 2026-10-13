import { defineScreens } from "../../shell/registry";
import { CommandRunner, ToolRunner } from "./AI";
import { Plugins } from "./Plugins";
import { PLUGINS_MESSAGES } from "./plugins-messages";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("future-facing-capabilities", [
  { id: "ai-command-runner", title: "AI: command runner", titles: { ar: "الذكاء الاصطناعي: مشغّل الأوامر" }, summary: "Runs a command through the processes API, or a mock result.", summaries: { ar: "يشغّل أمرًا عبر واجهة العمليات، أو يعرض نتيجة وهمية." }, component: CommandRunner },
  { id: "ai-tool-runner", title: "AI: tool runner", titles: { ar: "الذكاء الاصطناعي: مشغّل الأدوات" }, summary: "Checks claude/codex availability and runs a prompt, or a mock invocation.", summaries: { ar: "يتحقق من توفّر claude وcodex ويشغّل طلبًا، أو استدعاءً وهميًا." }, component: ToolRunner },
  { id: "plugins", title: "Plugins", titles: { ar: PLUGINS_MESSAGES.ar.title }, summary: "Bundled plugins loaded into isolated runtimes: manifest, API version and capability checks, registered commands, panels, file types and menu items, a rejected sandbox violation, error isolation and unload.", summaries: { ar: "إضافات مضمّنة تُحمَّل في بيئات تشغيل معزولة: فحص البيان وإصدار الواجهة والقدرات، والأوامر واللوحات وأنواع الملفات وعناصر القوائم المسجّلة، ومخالفة مرفوضة لصندوق العزل، وعزل الأخطاء، وإلغاء التحميل." }, component: Plugins },
]);
