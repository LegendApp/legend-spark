import { useI18n } from "../../shell/app-controller";
import { MESSAGES, type Locale } from "../../shell/i18n";

// Strings for the Hang watchdog screen. Availability, state and checks are API values or JSON, so
// flows can assert them in any locale; they are not translated.
export type HangWatchdogMessages = {
  sections: { watchdog: string; block: string; reports: string };
  intro: string;
  threshold: string;
  thresholdOption(ms: number): string;
  start: string;
  stop: string;
  block(ms: number): string;
  blocking(ms: number): string;
  blockHint: string;
  clear: string;
  count(count: number): string;
  none: string;
  report(index: number, durationMs: number, thresholdMs: number, at: string): string;
  simulated: string;
};

const en: HangWatchdogMessages = {
  sections: { watchdog: "Watchdog", block: "Block the main thread", reports: "Reported hangs" },
  intro: "A watchdog thread pings the main run loop. A ping left unanswered past the threshold is a hang: its stack is sampled then, and the hang is reported with its duration once the main thread answers.",
  threshold: "Threshold",
  thresholdOption: ms => ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`,
  start: "Start watchdog",
  stop: "Stop watchdog",
  block: ms => ms >= 1000 ? `Block for ${ms / 1000} s` : `Block for ${ms} ms`,
  blocking: ms => `Blocking the main thread for ${ms} ms…`,
  blockHint: "The whole app stops responding while it is blocked. A block shorter than the threshold is not a hang.",
  clear: "Clear reports",
  count: count => count === 1 ? "1 hang" : `${count} hangs`,
  none: "No hangs reported yet.",
  report: (index, durationMs, thresholdMs, at) => `Hang ${index} · ${Math.round(durationMs).toLocaleString("en")} ms (threshold ${thresholdMs} ms) · ${at}`,
  simulated: "Latest blocked hang, compared with its block",
};

const n = MESSAGES.ar.number;
const ar: HangWatchdogMessages = {
  sections: { watchdog: "المراقب", block: "حظر الخيط الرئيسي", reports: "حالات التعليق المُبلّغ عنها" },
  intro: "يرسل خيط المراقبة نبضات إلى حلقة التشغيل الرئيسية. النبضة التي تبقى بلا رد بعد الحد تعني تعليقًا: تُلتقط عندها مكدّس الاستدعاءات، ويُبلَّغ عن التعليق ومدته حين يستجيب الخيط الرئيسي.",
  threshold: "الحد",
  thresholdOption: ms => ms >= 1000 ? `${n(ms / 1000)} ث` : `${n(ms)} م.ث`,
  start: "تشغيل المراقب",
  stop: "إيقاف المراقب",
  block: ms => ms >= 1000 ? `حظر لمدة ${n(ms / 1000)} ث` : `حظر لمدة ${n(ms)} م.ث`,
  blocking: ms => `يُحظر الخيط الرئيسي لمدة ${n(ms)} م.ث…`,
  blockHint: "يتوقف التطبيق كله عن الاستجابة أثناء الحظر. الحظر الأقصر من الحد ليس تعليقًا.",
  clear: "مسح التقارير",
  count: count => count === 1 ? "تعليق واحد" : `${n(count)} حالات تعليق`,
  none: "لم يُبلَّغ عن أي تعليق بعد.",
  report: (index, durationMs, thresholdMs, at) => `التعليق ${n(index)} · ${n(Math.round(durationMs))} م.ث (الحد ${n(thresholdMs)} م.ث) · ${at}`,
  simulated: "آخر تعليق ناتج عن الحظر، مقارنةً بالحظر",
};

export const HANG_WATCHDOG_MESSAGES: Record<Locale, HangWatchdogMessages> = { en, ar };
export function useHangWatchdogMessages() { return HANG_WATCHDOG_MESSAGES[useI18n().locale]; }
