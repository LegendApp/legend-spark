import type { PropsWithChildren } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import type { NetworkEntry } from "@legendapp/spark/devtools";
import { Button } from "../../Controls";
import { SCENARIOS, useNetworkDemo } from "./network-demo";
import { useNetworkMessages } from "./network-messages";

// Test IDs: devtools-network-{availability,available,unavailable,server,log,empty}, devtools-network-run-<scenario>,
// devtools-network-result-<scenario>, and devtools-network-entry-<source>-<state> per recorded entry.
const ID = "devtools-network";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-full max-w-3xl gap-2">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}

function Entry({ entry }: { entry: NetworkEntry }) {
  const body = entry.responseBody;
  return <View className="gap-1 border-b border-border px-4 py-2" testID={`${ID}-entry-${entry.source}-${entry.state}`}>
    <Text selectable className="font-mono text-xs text-foreground">{`${entry.source}${entry.module ? ` ${entry.module}` : ""} ${entry.method} ${entry.url}`}</Text>
    <Text selectable className="font-mono text-xs text-muted">
      {[entry.state, entry.status, entry.endedAt === undefined ? undefined : `${entry.endedAt - entry.startedAt} ms`,
        body ? `${body.size ?? "?"}${body.truncated ? " (truncated)" : ""} ${body.base64 ? "base64" : "text"}` : undefined,
        entry.frames ? `${entry.frames.length} frames` : undefined, entry.error].filter(part => part !== undefined).join(" · ")}
    </Text>
    {Object.keys(entry.requestHeaders).length ? <Text selectable className="font-mono text-xs text-muted">{JSON.stringify(entry.requestHeaders)}</Text> : null}
  </View>;
}

export function Network() {
  const t = useNetworkMessages();
  const { availability, log, server, setServer, base, results, run } = useNetworkDemo();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="items-center gap-5 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="max-w-3xl text-center text-sm text-muted">{t.intro}</Text>
    <Section title={t.sections.availability}>
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      <Text className="text-sm text-foreground" testID={availability.available ? `${ID}-available` : `${ID}-unavailable`}>{availability.available ? t.available : t.unavailable}</Text>
    </Section>
    {availability.available ? <>
      <Section title={t.sections.requests}>
        <Text className="text-sm text-muted">{t.serverHint}</Text>
        <TextInput testID={`${ID}-server`} accessibilityLabel={t.server} placeholder="http://127.0.0.1:<port>/" autoCapitalize="none" autoCorrect={false}
          className="w-96 max-w-full rounded-md border border-border bg-surface p-2 font-mono text-foreground" value={server} onChangeText={setServer} />
        <View className="gap-2">
          {SCENARIOS.map(scenario => <View key={scenario} className="flex-row flex-wrap items-center gap-3">
            <Button testID={`${ID}-run-${scenario}`} disabled={!base} onPress={() => run(scenario)}>{t.scenarios[scenario]}</Button>
            {results[scenario] ? <Text selectable numberOfLines={2} className="flex-1 font-mono text-xs text-muted" testID={`${ID}-result-${scenario}`}>{results[scenario]}</Text> : null}
          </View>)}
        </View>
      </Section>
      <Section title={t.sections.log}>
        <View className="overflow-hidden rounded-lg border border-border bg-surface" testID={`${ID}-log`}>
          {log.length ? [...log].reverse().map(entry => <Entry key={entry.id} entry={entry} />) : <Text className="px-4 py-2 text-sm text-muted" testID={`${ID}-empty`}>{t.empty}</Text>}
        </View>
      </Section>
    </> : null}
  </ScrollView>;
}
