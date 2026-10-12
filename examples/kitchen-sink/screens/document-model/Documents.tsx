import type { ComponentProps, PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { useDocumentSessionState, type DocumentSession } from "@legendapp/spark/app/documents";
import type { Availability } from "@legendapp/spark/contracts";
import { Button as NativeButton } from "@legendapp/spark/ui/uniwind";
import { CHECKS, useDocumentsDemo, type DemoState } from "./documents-demo";
import { useDocumentsMessages, type DocumentsMessages } from "./documents-messages";

// Test IDs: document-model-documents-{name,path,text,edited,saved,locked,read-only,conflict}, -<action> buttons,
// -result, -availability-{session,versions}-<available|reason>, -unsupported-<code>, -check-<id>-{passed,failed},
// -checks-done, -version-<n>, -duplicate-{name,edited}, -opened-file and -focused-existing.
const ID = "document-model-documents";
const kebab = (value: string) => value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`).replaceAll("_", "-").toLowerCase();
const availabilityID = (value: Availability) => value.available ? "available" : value.reason;

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-full max-w-3xl gap-2">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}
function Action(props: ComponentProps<typeof NativeButton>) { return <NativeButton className="min-w-40" {...props} />; }
function Flag({ id, label }: { id: string; label: string }) {
  return <Text className="rounded-md bg-highlight px-2 py-0.5 text-xs text-foreground" testID={`${ID}-${id}`}>{label}</Text>;
}

function DocumentPanel({ session, t }: { session: DocumentSession; t: DocumentsMessages }) {
  const state = useDocumentSessionState(session);
  return <View className="gap-2 rounded-md border border-border p-3">
    <View className="flex-row flex-wrap items-center gap-2">
      <Text className="text-base font-semibold text-foreground" testID={`${ID}-name`}>{state.name}</Text>
      {state.edited ? <Flag id="edited" label={t.state.edited} /> : <Flag id="saved" label={t.state.saved} />}
      {state.locked && <Flag id="locked" label={t.state.locked} />}
      {state.readOnly && <Flag id="read-only" label={t.state.readOnly} />}
      {state.conflict && <Flag id="conflict" label={t.state.conflict} />}
    </View>
    <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-path`}>{`${t.state.path}: ${state.path ?? t.state.untitled}`}</Text>
    <Text className="text-xs text-muted">{t.state.autosave}</Text>
    <Text selectable className="min-h-16 rounded-md bg-background p-2 font-mono text-xs text-foreground" testID={`${ID}-text`}>{state.text}</Text>
  </View>;
}

function DuplicatePanel({ session, t }: { session: DocumentSession; t: DocumentsMessages }) {
  const state = useDocumentSessionState(session);
  return <View className="flex-row flex-wrap items-center gap-2">
    <Text className="text-sm text-foreground" testID={`${ID}-duplicate-name`}>{state.name}</Text>
    {state.edited && <Flag id="duplicate-edited" label={t.state.edited} />}
  </View>;
}

function Operations({ demo, state, t }: { demo: NonNullable<ReturnType<typeof useDocumentsDemo>["demo"]>; state: DemoState; t: DocumentsMessages }) {
  const busy = state.running || !state.session, { actions: a } = t;
  const buttons: [string, string, () => unknown][] = [
    ["new", a.newDocument, demo.newDocument], ["edit", a.edit, demo.edit], ["save-as", a.saveAs, demo.saveAs], ["save", a.save, () => demo.save()],
    ["overwrite", a.overwrite, () => demo.save(true)], ["duplicate", a.duplicate, demo.duplicate], ["rename", a.rename, demo.rename], ["move-to", a.moveTo, demo.moveTo],
    ["revert", a.revert, demo.revert], ["lock", a.lock, () => demo.setLocked(true)], ["unlock", a.unlock, () => demo.setLocked(false)],
    ["external-change", a.externalChange, demo.externalChange], ["add-version", a.refreshVersions, demo.addVersion], ["close", a.close, demo.closeDocument],
  ];
  return <View className="flex-row flex-wrap gap-2">
    {buttons.map(([id, label, press]) => <Action key={id} testID={`${ID}-${id}`} disabled={busy} onPress={() => void press()}>{label}</Action>)}
  </View>;
}

export function Documents() {
  const t = useDocumentsMessages();
  const { state, demo } = useDocumentsDemo(t);
  const done = !state.running && CHECKS.every(id => state.checks[id]);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="items-center gap-5 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="max-w-3xl text-center text-sm text-muted">{t.intro}</Text>
    <Section title={t.sections.availability}>
      {(["session", "versions"] as const).map(kind => <Text key={kind} selectable className="font-mono text-xs text-muted" testID={`${ID}-availability-${kind}-${availabilityID(state.availability[kind])}`}>
        {`${kind === "session" ? "getDocumentSessionAvailability" : "getDocumentVersionsAvailability"}(): ${JSON.stringify(state.availability[kind])}`}
      </Text>)}
      {state.unsupportedCode && <Text selectable className="font-mono text-xs text-danger" testID={`${ID}-unsupported-${kebab(state.unsupportedCode)}`}>{`createDocumentSession: ${state.unsupportedCode}`}</Text>}
      {state.error && <Text selectable className="text-xs text-danger" testID={`${ID}-error`}>{state.error}</Text>}
    </Section>
    {state.session && demo && <>
      <Section title={t.sections.checks}>
        <Action testID={`${ID}-run-all`} disabled={state.running} onPress={() => void demo.runAll()}>{state.running ? t.running : t.actions.runAll}</Action>
        <View className="gap-1 rounded-md border border-border p-3" testID={done ? `${ID}-checks-done` : `${ID}-checks`}>
          {CHECKS.map(id => {
            const result = state.checks[id];
            return <Text key={id} selectable className={`text-xs ${result && !result.passed ? "text-danger" : "text-muted"}`} testID={result ? `${ID}-check-${kebab(id)}-${result.passed ? "passed" : "failed"}` : undefined}>
              {`${result ? (result.passed ? "PASS" : "FAIL") : "—"} ${t.checks[id]}${result ? ` · ${result.detail}` : ""}`}
            </Text>;
          })}
        </View>
      </Section>
      <Section title={t.sections.document}>
        <DocumentPanel key={state.session.getState().path ?? "untitled"} session={state.session} t={t} />
        <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-result`}>{t.result(state.result ?? "—")}</Text>
        {state.opened.length > 0 && <Text selectable className="text-xs text-muted" testID={`${ID}-opened-file`}>{state.opened.join(", ")}</Text>}
        {state.focused > 0 && <Text className="text-xs text-muted" testID={`${ID}-focused-existing`}>{`showWindow(main, { focus: true }) × ${state.focused}`}</Text>}
      </Section>
      <Section title={t.sections.operations}><Operations demo={demo} state={state} t={t} /></Section>
      {state.duplicate && <Section title={t.sections.duplicate}><DuplicatePanel session={state.duplicate} t={t} /></Section>}
      <Section title={t.sections.versions}>
        {state.versions.length === 0 ? <Text className="text-xs text-muted">{t.noVersions}</Text>
          : state.versions.map((version, index) => <View key={version.id} className="flex-row items-center gap-2" testID={`${ID}-version-${index}`}>
            <Text className="flex-1 font-mono text-xs text-muted">{new Date(version.modifiedAt).toISOString()}</Text>
            <NativeButton className="w-24" testID={`${ID}-restore-${index}`} disabled={state.running} onPress={() => void demo.restore(version.id)}>{t.actions.restore}</NativeButton>
          </View>)}
      </Section>
    </>}
  </ScrollView>;
}
