import React from "react";
import { Text, View } from "react-native";
import * as updates from "@legendapp/spark/updates";
import { ActionButton } from "./ActionButton";
import { EventResults, useEventResults } from "./EventResults";
import { useUpdates } from "./useUpdates";

const hours = (seconds: number) => seconds % 3600 === 0 ? `${seconds / 3600} h` : `${seconds} s`;

export function UpdatesScreen({ report }: { report: (value: unknown) => void }) {
  const [events, reportEvent] = useEventResults(report);
  const { availability, status, run } = useUpdates(reportEvent);
  const available = status?.available ? status : undefined;
  const rows: [string, string, string][] = [
    ["availability", "Availability", !availability ? "Loading…" : availability.available ? "Available" : `Unavailable (${availability.reason})`],
    ["started", "Updater started", status ? String(status.started) : "…"],
    ["automatic", "Automatic checks", available ? (available.automaticallyChecks ? "On" : "Off") : "—"],
    ["interval", "Check interval", available ? hours(available.checkIntervalSeconds) : "—"],
    ["skipped", "Skipped build", available ? available.skippedBuild ?? "None" : "—"],
    ["skipped-major", "Skipped major build", available ? available.skippedMajorBuild ?? "None" : "—"],
    ["last-checked", "Last checked", available ? available.lastCheckedAt ?? "Never" : "—"],
  ];
  return <View style={{ gap: 12 }}>
    <Text style={{ fontSize: 18, fontWeight: "600" }} className="text-foreground">App updates</Text>
    <View className="gap-1 rounded-md border border-border p-3">
      {rows.map(([id, label, value]) => <View key={id} style={{ flexDirection: "row", gap: 8 }}>
        <Text className="text-sm text-muted" style={{ width: 140 }}>{label}</Text>
        <Text selectable className="text-sm text-foreground" testID={`updates-api-${id}`}>{value}</Text>
      </View>)}
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      <ActionButton testID="updates-api-check" onPress={() => run(updates.checkForUpdates)}>Check for updates</ActionButton>
      <ActionButton testID="updates-api-background" onPress={() => run(() => updates.checkForUpdates({ mode: "background" }))}>Background check</ActionButton>
      <ActionButton testID="updates-api-automatic" onPress={() => run(() => updates.configureUpdates({ automaticallyChecks: !available?.automaticallyChecks }))}>{available?.automaticallyChecks ? "Disable automatic checks" : "Enable automatic checks"}</ActionButton>
      <ActionButton testID="updates-api-interval-hour" onPress={() => run(() => updates.configureUpdates({ checkIntervalSeconds: updates.MINIMUM_UPDATE_CHECK_INTERVAL_SECONDS }))}>Check hourly</ActionButton>
      <ActionButton testID="updates-api-interval-day" onPress={() => run(() => updates.configureUpdates({ checkIntervalSeconds: 86400 }))}>Check daily</ActionButton>
      <ActionButton testID="updates-api-interval-short" onPress={() => run(() => updates.configureUpdates({ checkIntervalSeconds: 600 }))}>Try 10-minute interval</ActionButton>
      <ActionButton testID="updates-api-clear-skipped" onPress={() => run(updates.clearSkippedUpdate)}>Clear skipped builds</ActionButton>
    </View>
    <EventResults entries={events} empty={available ? "Check for updates to see progress here." : "Update events require a configured distribution build."} testID="updates-api-events" />
  </View>;
}
