import { useState, type ReactNode } from "react";
import { Image, ScrollView, Text, TextInput, View } from "react-native";
import { Button as NativeButton } from "@legendapp/spark/ui/uniwind";
import type { ManualStep, Signoff, SignoffItem } from "../../../../scripts/e2e/format/signoff";
import { useI18n } from "../../shell/app-controller";
import type { Locale } from "../../shell/i18n";
import { currentSignoff, decide, resolvePath, useSignOff, type SignOffProblem, type SignOffState, type Verdict } from "./sign-off";

// Test IDs: infra-sign-off-{loading,no-session,error,session,save-error}; per run i: infra-sign-off-item-<i>, its status
// infra-sign-off-item-<i>-{pending,passed,failed,not-ready}, -screenshot-<step>, -note, -pass, -fail and -problem.
const ID = "infra-sign-off";
type Ready = Extract<SignOffState, { status: "ready" }>;
type Status = "pending" | "passed" | "failed" | "not-ready";

type Messages = {
  title: string; intro: string; loading: string; noSession: string; loadFailed: string;
  target: string; commit: string; signer: string; progress(signed: string, total: string): string;
  kind: Record<SignoffItem["kind"], string>; status: Record<Status, string>;
  step(number: string): string; instruction: string; expect: string; optional: string;
  noScreenshot: string; noEvidence: string; note: string; notePlaceholder: string; pass: string; fail: string;
  signed(verdict: Verdict, by: string, machine: string, at: string): string; problems: Record<SignOffProblem, string>; saveFailed: string;
};
const MESSAGES: Record<Locale, Messages> = {
  en: {
    title: "Manual sign-off",
    intro: "The manual steps of the last gate run at this commit. Do each step, or review its screenshot, compare it with the expected result, then pass or fail the run. A failure needs a note. Each decision is saved at once; when you quit, confirm them at the terminal and bun run gate:signoff writes them to the sign-off file.",
    loading: "Reading the sign-off session…",
    noSession: "No sign-off session is open. Run bun run gate, then bun run gate:signoff: it opens this screen in the release build with the runs that need a person's sign-off.",
    loadFailed: "The sign-off session could not be read.",
    target: "Target", commit: "Commit", signer: "Signing as",
    progress: (signed, total) => `${signed} of ${total} runs signed off`,
    kind: { manual: "Manual", partial: "Run + sign-off" },
    status: { pending: "Pending", passed: "Passed", failed: "Failed", "not-ready": "Not ready" },
    step: number => `Step ${number}`, instruction: "Do", expect: "Expect", optional: "Optional",
    noScreenshot: "No screenshot was captured: describe what you saw in the note.", noEvidence: "No evidence is asked for.",
    note: "Note", notePlaceholder: "What you saw. Required for a failure.", pass: "Pass", fail: "Fail",
    signed: (verdict, by, machine, at) => `Signed off as ${verdict === "pass" ? "passed" : "failed"} by ${by} on ${machine}, ${at}`,
    problems: {
      "not-ready": "This run cannot be signed off yet.",
      "fail-needs-note": "A failed sign-off needs a note that says what was wrong.",
      "evidence-needs-note": "No screenshot was captured, so describe what you saw in the note.",
    },
    saveFailed: "Decisions could not be saved",
  },
  ar: {
    title: "التوقيع اليدوي",
    intro: "الخطوات اليدوية لآخر تشغيل لبوابة الإصدار عند هذا الإيداع. نفّذ كل خطوة أو راجع لقطة الشاشة الخاصة بها، وقارنها بالنتيجة المتوقعة، ثم اعتمد التشغيل ناجحًا أو فاشلًا. يتطلب الفشل ملاحظة. يُحفظ كل قرار فورًا، وعند إنهاء التطبيق أكّدها في الطرفية ليكتبها bun run gate:signoff في ملف التواقيع.",
    loading: "جارٍ قراءة جلسة التوقيع…",
    noSession: "لا توجد جلسة توقيع مفتوحة. شغّل bun run gate ثم bun run gate:signoff، فيفتح هذه الشاشة في بناء الإصدار مع عمليات التشغيل التي تحتاج إلى توقيع شخص.",
    loadFailed: "تعذّرت قراءة جلسة التوقيع.",
    target: "الهدف", commit: "الإيداع", signer: "التوقيع باسم",
    progress: (signed, total) => `وُقّع ${signed} من ${total} من عمليات التشغيل`,
    kind: { manual: "يدوي", partial: "تشغيل ثم توقيع" },
    status: { pending: "بانتظار التوقيع", passed: "ناجح", failed: "فاشل", "not-ready": "غير جاهز" },
    step: number => `الخطوة ${number}`, instruction: "نفّذ", expect: "المتوقع", optional: "اختياري",
    noScreenshot: "لم تُلتقط لقطة شاشة: صِف ما رأيته في الملاحظة.", noEvidence: "لا يُطلب دليل.",
    note: "ملاحظة", notePlaceholder: "ما رأيته. مطلوبة عند الفشل.", pass: "ناجح", fail: "فاشل",
    signed: (verdict, by, machine, at) => `وُقّع ${verdict === "pass" ? "ناجحًا" : "فاشلًا"} بواسطة ${by} على ${machine}، ${at}`,
    problems: {
      "not-ready": "لا يمكن توقيع هذا التشغيل بعد.",
      "fail-needs-note": "يتطلب التوقيع بالفشل ملاحظة توضح الخطأ.",
      "evidence-needs-note": "لم تُلتقط لقطة شاشة، لذا صِف ما رأيته في الملاحظة.",
    },
    saveFailed: "تعذّر حفظ القرارات",
  },
};

const statusOf = (item: SignoffItem, signoff: Signoff | undefined): Status => signoff ? (signoff.verdict === "pass" ? "passed" : "failed") : item.ready ? "pending" : "not-ready";
const PILL: Record<Status, string> = { pending: "bg-highlight text-foreground", passed: "bg-success text-background", failed: "bg-danger text-background", "not-ready": "border border-border text-muted" };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-x-3 gap-y-1">
    <Text className="w-28 text-sm text-muted">{label}</Text>
    <Text selectable className="flex-1 font-mono text-sm text-foreground">{children}</Text>
  </View>;
}

function Step({ step, index, dir, testID, t }: { step: ManualStep; index: number; dir: string; testID: string; t: Messages }) {
  const { t: shell } = useI18n();
  return <View className="gap-1.5">
    <View className="h-px bg-border" />
    <Text className="text-xs font-semibold text-muted">{`${t.step(shell.number(index + 1))}${step.signoff === "optional" ? ` · ${t.optional}` : ""} · ${step.location}`}</Text>
    <Text className="text-sm text-foreground"><Text className="font-semibold">{`${t.instruction}: `}</Text>{step.instruction}</Text>
    <Text className="text-sm text-foreground"><Text className="font-semibold">{`${t.expect}: `}</Text>{step.expect}</Text>
    {step.screenshot
      ? <Image testID={`${testID}-screenshot-${index}`} accessibilityLabel={step.instruction} resizeMode="contain" style={{ width: "100%", height: 220 }}
        source={{ uri: `file://${encodeURI(resolvePath(dir, step.screenshot))}` }} />
      : <Text className="text-xs text-muted">{step.evidence === "none" ? t.noEvidence : t.noScreenshot}</Text>}
  </View>;
}

function Item({ item, index, current, t }: { item: SignoffItem; index: number; current: Ready; t: Messages }) {
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<SignOffProblem>();
  const testID = `${ID}-item-${index}`, signoff = currentSignoff(current, item), status = statusOf(item, signoff);
  const sign = (verdict: Verdict) => setProblem(decide(item.flow, verdict, note));
  return <View className="gap-2 rounded-md border border-border bg-surface p-3" testID={testID}>
    <View className="flex-row flex-wrap items-center gap-2">
      <Text className="flex-1 text-base font-semibold text-foreground">{item.name}</Text>
      <Text className="rounded-md border border-border px-2 py-0.5 text-xs text-muted">{t.kind[item.kind]}</Text>
      <Text className={`rounded-md px-2 py-0.5 text-xs ${PILL[status]}`} testID={`${testID}-${status}`}>{t.status[status]}</Text>
    </View>
    <Text selectable className="font-mono text-xs text-muted">{item.flow}</Text>
    {item.intent && <Text className="text-sm text-muted">{item.intent}</Text>}
    {item.reason && <Text selectable className="text-sm text-danger">{item.reason}</Text>}
    {item.steps.map((step, stepIndex) => <Step key={stepIndex} step={step} index={stepIndex} dir={current.dir} testID={testID} t={t} />)}
    {signoff && <Text selectable className="text-sm text-foreground">{`${t.signed(signoff.verdict, signoff.by, signoff.machine, signoff.at)}${signoff.note ? `: ${signoff.note}` : ""}`}</Text>}
    {item.ready && <>
      <TextInput multiline accessibilityLabel={t.note} placeholder={t.notePlaceholder} testID={`${testID}-note`} value={note} onChangeText={setNote}
        className="min-h-14 rounded-md border border-border bg-background p-2 text-sm text-foreground" />
      <View className="flex-row flex-wrap gap-2">
        <NativeButton className="min-w-28" testID={`${testID}-pass`} onPress={() => sign("pass")}>{t.pass}</NativeButton>
        <NativeButton className="min-w-28" testID={`${testID}-fail`} onPress={() => sign("fail")}>{t.fail}</NativeButton>
      </View>
    </>}
    {problem && <Text className="text-sm text-danger" testID={`${testID}-problem`}>{t.problems[problem]}</Text>}
  </View>;
}

/** The checklist for a `bun run gate:signoff` session: each run's manual steps, evidence, and a pass/fail decision. */
export function SignOff() {
  const { locale, t: shell } = useI18n();
  const t = MESSAGES[locale];
  const current = useSignOff();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    {current.status === "loading" && <Text className="text-sm text-muted" testID={`${ID}-loading`}>{t.loading}</Text>}
    {current.status === "no-session" && <Text selectable className="rounded-md border border-border p-3 text-sm text-foreground" testID={`${ID}-no-session`}>{t.noSession}</Text>}
    {current.status === "error" && <Text selectable className="text-sm text-danger" testID={`${ID}-error`}>{`${t.loadFailed} ${current.error}`}</Text>}
    {current.status === "ready" && <>
      <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-session`}>
        <Field label={t.target}>{current.session.target}</Field>
        <Field label={t.commit}>{current.session.commit.slice(0, 12)}</Field>
        <Field label={t.signer}>{`${current.session.by} · ${current.session.machine}`}</Field>
        <Text className="text-sm text-foreground">{t.progress(shell.number(current.session.items.filter(item => currentSignoff(current, item)).length), shell.number(current.session.items.length))}</Text>
      </View>
      {current.saveError && <Text selectable className="text-sm text-danger" testID={`${ID}-save-error`}>{`${t.saveFailed}: ${current.saveError}`}</Text>}
      {current.session.items.map((item, index) => <Item key={item.flow} item={item} index={index} current={current} t={t} />)}
    </>}
  </ScrollView>;
}
