import { ActionButton } from "./ActionButton";
import { EventResults, useEventResults } from "./EventResults";
import React, { useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import * as notifications from "@legendapp/spark/notifications";
import { createTray } from "@legendapp/spark/tray";
import * as updates from "@legendapp/spark/updates";
import { showWindow } from "@legendapp/spark/windows";

export function Integrations({ report }: { report: (value: unknown) => void }) {
  const [permission, setPermission] = useState<string>("Loading…");
  const [trayActive, setTrayActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<updates.UpdateStatus>();
  const tray = useRef<Awaited<ReturnType<typeof createTray>> | undefined>(undefined);
  const mounted = useRef(false);
  const [notificationEvents, reportNotification] = useEventResults(report);
  const [trayEvents, reportTray] = useEventResults(report);
  const [updateEvents, reportUpdate] = useEventResults(report);
  useEffect(() => {
    mounted.current = true;
    let response: { remove(): void } | undefined;
    let disposed = false;
    void notifications.getNotificationPermission().then(value => { if (!disposed) setPermission(value.status); }).catch(reportNotification);
    void notifications.onNotificationResponse(reportNotification).then(value => { if (disposed) value.remove(); else response = value; }).catch(reportNotification);
    void updates.getUpdateStatus().then(async value => { if (value.available) { await updates.startUpdates(); value = await updates.getUpdateStatus(); } if (!disposed) setUpdateStatus(value); }).catch(reportUpdate);
    let events: { remove(): void } | undefined;
    try { events = updates.onUpdateEvent(event => reportUpdate(event.state === "error" ? new Error(event.message ?? "Update failed") : event)); }
    catch (error) { reportUpdate(error); }
    return () => { disposed = true; mounted.current = false; response?.remove(); events?.remove(); void tray.current?.remove().catch(reportTray); tray.current = undefined; };
  }, [reportNotification, reportTray, reportUpdate]);
  async function act(fn: () => Promise<unknown>) { try { const result = await fn(); if (result !== undefined) report(result); return result; } catch (error) { report(String(error)); throw error; } }
  async function toggleTray() {
    setBusy(true);
    try {
      if (tray.current) { await tray.current.remove(); tray.current = undefined; if (mounted.current) setTrayActive(false); }
      else {
        const item = await createTray({ id: "kitchen", title: "Kitchen Sink", ...(Platform.OS === "macos" ? { macos: { symbol: "cup.and.saucer" } } : {}), tooltip: "Desktop Kitchen Sink", menu: [
          { type: "action", id: "open", label: "Show kitchen sink" }, { type: "separator" }, { type: "checkbox", id: "checked", label: "Checked item", checked: true }, { type: "action", id: "disabled", label: "Disabled item", disabled: true },
        ], onAction: event => { reportTray(event); if (event.type === "action" && event.itemId === "open") void showWindow("main").catch(reportTray); } });
        if (!mounted.current) await item.remove(); else { tray.current = item; setTrayActive(true); }
      }
    } finally { if (mounted.current) setBusy(false); }
  }
  return <View style={{ gap: 18 }}>
    <Text style={{ fontSize: 18, fontWeight: "600" }} className="text-foreground">Notifications</Text>
    <Text className="text-muted">Permission: {permission}. The prebuilt runtime shares its host’s notification permission.</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      <ActionButton onPress={() => act(async () => setPermission((await notifications.requestNotificationPermission()).status))}>Enable notifications</ActionButton>
      <ActionButton onPress={() => act(async () => { await notifications.showNotification({ id: "kitchen-demo", content: { title: "Hello from the kitchen sink", body: "Click to exercise notification responses.", data: { screen: "kitchen" } } }); reportNotification("Notification submitted; waiting for a response."); return "Notification submitted."; })}>Send test notification</ActionButton>
      <ActionButton onPress={() => act(async () => { await notifications.cancelAllNotifications(); await notifications.dismissAllNotifications(); })}>Clear project notifications</ActionButton>
    </View>
    <EventResults entries={notificationEvents} empty="Send a test notification and click it to see its response here." testID="notification-events" />
    <Text style={{ fontSize: 18, fontWeight: "600" }} className="text-foreground">Menu bar</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      <ActionButton disabled={busy} onPress={() => act(toggleTray)}>{trayActive ? "Remove menu-bar item" : "Create menu-bar item"}</ActionButton>
      <ActionButton disabled={!trayActive || busy} onPress={() => act(async () => { await tray.current?.update({ title: "Hello" }); })}>Update menu-bar title</ActionButton>
    </View>
    <EventResults entries={trayEvents} empty="Create the menu-bar item, then choose an item from its menu." testID="tray-events" />
    <Text style={{ fontSize: 18, fontWeight: "600" }} className="text-foreground">App updates</Text>
    <Text className="text-muted">{updateStatus?.available ? "Signed updates configured" : `Updates unavailable: ${updateStatus?.reason ?? "Loading…"}`}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      <ActionButton disabled={!updateStatus?.available} onPress={() => act(updates.checkForUpdates)}>Check for updates</ActionButton>
      <ActionButton disabled={!updateStatus?.available} onPress={() => act(async () => { await updates.configureUpdates({ automaticallyChecks: !updateStatus?.automaticallyChecks }); setUpdateStatus(await updates.getUpdateStatus()); })}>{updateStatus?.automaticallyChecks ? "Disable automatic checks" : "Enable automatic checks"}</ActionButton>
    </View>
    <EventResults entries={updateEvents} empty={updateStatus?.available ? "Check for updates to see progress here." : "Update events require a configured distribution build."} testID="update-events" />
  </View>;
}
