import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { showMessage } from "@legendapp/spark/dialogs";
import { showContextMenu } from "@legendapp/spark/context-menu";
import { DragDropView } from "@legendapp/spark/drag-drop";
import * as notifications from "@legendapp/spark/notifications";
import * as system from "@legendapp/spark/system";
import { createTray } from "@legendapp/spark/tray";
import { registerGlobalShortcut } from "@legendapp/spark/global-shortcuts";
import { configureMenus, clearMenus, addNativeMenuActionListener, updateMenuItems, commandModifier } from "@legendapp/spark/menus";
import { getWindow, openWindow, closeWindow, onWindowEvent } from "@legendapp/spark/windows";
import { assertContract } from "./contract-cases";

async function requireError(action: () => Promise<unknown>, code: string) {
  try { await action(); } catch (error) { assertContract((error as { code?: string }).code === code, `Expected ${code}: ${String(error)}`); return; }
  throw new Error(`Expected ${code}`);
}
export default function DesktopInteractionChecks({ check, onError, onBusy }: {
  check: (id: string, action: () => Promise<void>) => Promise<void>; onError: (message: string) => void; onBusy: (busy: boolean) => void;
}) {
  const anchor = useRef<View>(null);
  const drag = useRef({ entered: false, dropped: false });
  const [dragFeedback, setDragFeedback] = useState("Drag ‘Drag source’ onto the drop target below. Child buttons must remain clickable.");
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState("Check native dialogs and menus before finishing the run.");
  function run(id: string, action: () => Promise<void>) {
    setBusy(true); onBusy(true);
    void check(id, action).catch(error => onError(String(error))).finally(() => { setBusy(false); onBusy(false); });
  }
  async function dialogs() {
    await requireError(() => showMessage({ title: "Missing parent", windowId: "nonexistent-contract-parent" }), "E_NOT_FOUND");
    setInstruction("Check Remember, then press Enter for Continue. In the next dialog, press Escape.");
    const first = showMessage({ title: "Dialog acceptance", message: "Check Remember, then press Enter to choose Continue. Cancel is also available with Escape.",
      windowId: "main", kind: "warning", buttons: [{ id: "cancel", label: "Cancel" }, { id: "ignore", label: "Ignore" }, { id: "continue", label: "Continue" }, { id: "other", label: "Other" }], defaultButtonId: "continue", cancelButtonId: "cancel", checkbox: { label: "Remember", checked: false } });
    // Attach handlers immediately; an unexpected native rejection must not leak.
    const [selected] = await Promise.all([first, (async () => { await requireError(() => showMessage({ title: "Must reject while busy" }), "E_BUSY"); })()]);
    assertContract(selected.buttonId === "continue" && selected.checked, "Expected Continue (index 2) and checked checkbox");
    const cancelled = await showMessage({ title: "Cancel acceptance", message: "Press Escape. Remember should already be checked.", kind: "info",
      buttons: [{ id: "cancel", label: "Cancel" }, { id: "continue", label: "Continue" }], defaultButtonId: "continue", cancelButtonId: "cancel", checkbox: { label: "Remember", checked: true } });
    assertContract(cancelled.buttonId === "cancel" && cancelled.checked, "Escape did not return the configured cancel index and checkbox state");
    setInstruction("Dialog assertions finished. Also check parent modality, all button labels, and keyboard focus visually.");
  }
  async function menus(location: { x: number; y: number }) {
    setInstruction("Choose Continue in the first menu. Check the marked item and disabled item visually. Dismiss the second menu with Escape.");
    const items = [
      { id: "marked", title: "Checked item", checked: true },
      { id: "disabled", title: "Disabled item", enabled: false },
      { id: "separator", title: "", separator: true },
      { id: "continue", title: "Continue" },
    ];
    const first = showContextMenu(items, location);
    const [selected] = await Promise.all([first, (async () => { await requireError(() => showContextMenu(items, location), "E_BUSY"); })()]);
    assertContract(selected === "continue", "Menu did not return the selected semantic ID");
    assertContract(await showContextMenu([{ id: "cancel", title: "Press Escape to dismiss" }], location) === null, "Dismissed menu must return null");
    setInstruction("Menu assertions finished. Also check placement, disabled/checked states, and keyboard navigation visually.");
  }
  async function tray() {
    setInstruction("Open the app icon in the tray/menu bar and choose Checks → Continue. On Windows it may be in the hidden-icons overflow.");
    let selected!: () => void;
    const action = new Promise<void>(resolve => { selected = resolve; });
    const item = await createTray({ id: "contract-tray", title: "Check", tooltip: "spark tray acceptance" }, event => { if (event.type === "trayAction" && event.itemId === "continue") selected(); });
    try {
      await requireError(() => createTray({ id: "contract-tray", title: "Duplicate" }), "E_TRAY_EXISTS");
      await item.update({ menu: [{ id: "checks", title: "Checks", items: [
        { id: "marked", title: "Checked", checked: true }, { id: "disabled", title: "Disabled", enabled: false },
        { separator: true }, { id: "continue", title: "Continue" },
      ] }] });
      await within(action, 45000);
    } finally { await item.remove(); await item.remove(); }
    setInstruction("Tray action and removal passed. Verify its icon disappeared.");
  }
  async function globalShortcut() {
    setInstruction("Focus another application, then press Control+Alt+Shift+F11 within 45 seconds.");
    let pressed!: () => void;
    const action = new Promise<void>(resolve => { pressed = resolve; });
    const accelerator = "Control+Alt+Shift+F11";
    const registration = await registerGlobalShortcut(accelerator, pressed);
    try {
      await requireError(() => registerGlobalShortcut(accelerator, () => {}), "E_BUSY");
      await within(action, 45000);
      assertContract(!(await getWindow()).focused, "Shortcut must be tested while another application has focus");
    } finally { await registration.remove(); await registration.remove(); }
    const replacement = await registerGlobalShortcut(accelerator, () => {}); await replacement.remove();
    setInstruction("Global shortcut, conflict rejection, removal, and re-registration passed.");
  }
  async function modalWindows() {
    setInstruction("A modal window will open. Verify the main window cannot receive input, then close the modal with its title-bar close button.");
    await requireError(() => openWindow({ id: "missing-parent-check", parentId: "absent", modal: true }), "E_NOT_FOUND");
    let closed!: () => void;
    const action = new Promise<void>(resolve => { closed = resolve; });
    const sub = onWindowEvent(event => { if (event.type === "closed" && event.windowId === "contract-modal") closed(); });
    let opened = false;
    try {
      await openWindow({ id: "contract-modal", parentId: "main", modal: true, title: "Close this modal to continue", width: 500, height: 400 }); opened = true;
      await within(action, 45000); opened = false;
    } finally { sub.remove(); if (opened) await closeWindow("contract-modal"); }
    setInstruction("Modal closed. Verify the main window accepts input again.");
  }
  async function advancedMenus() {
    setInstruction("Use Command+Shift+Y (macOS) or Control+Shift+Y (Windows) to activate the Parity → Continue item.");
    let selected!: (event: import("@legendapp/spark/menus").NativeMenuAction) => void;
    const action = new Promise<import("@legendapp/spark/menus").NativeMenuAction>(resolve => { selected = resolve; });
    const sub = addNativeMenuActionListener(event => { if (event.ownerId === "contract-binding") selected(event); });
    configureMenus("contract-base", [{ id: "parity", title: "Parity", items: [{ id: "base", title: "Original" }, { id: "after", title: "After" }] }]);
    configureMenus("contract-binding", [{ id: "bound", title: "Parity", items: [{ id: "continue", targetTitle: "Original", title: "Continue", placement: { after: "After" }, shortcut: { key: "y", modifiers: commandModifier | (1 << 17) }, payload: { token: "acceptance" } }] }]);
    updateMenuItems("contract-binding", [{ id: "continue", checked: true }]);
    try {
      let received: import("@legendapp/spark/menus").NativeMenuAction | undefined;
      await within(action.then(value => { received = value; }), 45000);
      assertContract(received?.itemId === "continue" && received.menuId === "bound" && received.payload?.token === "acceptance", "Menu action lost semantic identity or payload");
    } finally { sub.remove(); clearMenus("contract-binding"); clearMenus("contract-base"); }
    setInstruction("Menu accelerator, targeting, update, and payload assertions passed.");
  }
  async function notificationChecks() {
    const permission = await notifications.requestNotificationPermission();
    assertContract(permission.granted, `Notification permission: ${permission.status}. Enable notifications in system settings and retry.`);
    const id = `contract-${Date.now()}`;
    let received!: (value: notifications.NotificationResponse) => void;
    const response = new Promise<notifications.NotificationResponse>(resolve => { received = resolve; });
    const sub = await notifications.onNotificationResponse(value => { if (value.notificationId === id) received(value); });
    try {
      await notifications.scheduleNotification({ id, content: { title: "Scheduled acceptance" }, trigger: { type: "delay", delaySeconds: 120 } });
      assertContract((await notifications.getPendingNotifications()).includes(id), "Scheduled notification is missing");
      await notifications.cancelNotification(id);
      assertContract(!(await notifications.getPendingNotifications()).includes(id), "Cancellation left a scheduled notification");
      setInstruction("Click the Spark notification to continue within 45 seconds. If hidden, open Notification Center.");
      await notifications.showNotification({ id, content: { title: "Click to continue", body: "spark notification acceptance", data: { token: id }, sound: false } });
      await within(response.then(value => { assertContract(value.action === "open" && value.data.token === id, "Notification response lost its action or data"); }), 45000);
    } finally { sub.remove(); await notifications.cancelNotification(id); await notifications.dismissNotification(id); }
    setInstruction("Scheduling, cancellation, and notification click passed. Cold launch and OS delivery after exit require the separate native lifecycle checks.");
  }
  async function systemChecks() {
    const info = await system.getSystemInfo();
    assertContract(!!info.osVersion && !!info.locale && info.idleSeconds >= 0 && (info.batteryLevel === null || (info.batteryLevel >= 0 && info.batteryLevel <= 1)), "Invalid system information");
    const sleep = await system.preventSleep("Platform acceptance", "display");
    await sleep.remove(); await sleep.remove();
    const subscription = await system.onSystemEvent(() => {}); subscription.remove();
    const attention = await system.requestAttention(); await attention.remove();
    setInstruction("Verify badge ‘1’ on the Dock/taskbar. Open the Dock/taskbar menu and choose Continue. Windows hides disabled task entries.");
    let selected!: () => void;
    const action = new Promise<void>(resolve => { selected = resolve; });
    await system.setDockBadge("1");
    let menu: Awaited<ReturnType<typeof system.setDockMenu>> | undefined;
    try {
      menu = await system.setDockMenu([{ id: "checked", title: "Checked", checked: true }, { id: "disabled", title: "Disabled", enabled: false }, { id: "continue", title: "Continue" }], id => { if (id === "continue") selected(); });
      await requireError(() => system.setDockMenu([{ id: "duplicate", title: "Duplicate" }], () => {}), "E_DOCK_MENU_EXISTS");
      await within(action, 45000);
    } finally { await menu?.remove(); await system.setDockBadge(""); }
    setInstruction("System API lifecycle and Dock/taskbar action passed. Sleep/wake, session lock and OS theme-change events still need explicit native checks.");
  }
  return <View style={{ gap: 8 }}>
    <Text>{instruction}</Text>
    <Text>{dragFeedback}</Text>
    <DragDropView source={{ text: "spark-drag-contract" }} onDragEnd={event => {
      if (event.accepted && drag.current.dropped && drag.current.entered) run("desktop.drag-drop", async () => {});
      else setDragFeedback("Drag was cancelled or did not reach the target. Try again.");
      drag.current = { entered: false, dropped: false };
    }} style={{ padding: 12, borderWidth: 1 }}><Text>Drag source</Text><Button onPress={() => setDragFeedback("Child button received a press; now drag the source text.")}>Child button</Button></DragDropView>
    <DragDropView onDragEnter={() => { drag.current.entered = true; }} onDragLeave={() => setDragFeedback("Drag left target")} onDrop={event => {
      drag.current.dropped = event.text === "spark-drag-contract" && event.x >= 0 && event.y >= 0;
      setDragFeedback(JSON.stringify(event));
    }} style={{ padding: 12, borderWidth: 1, minHeight: 70 }}><Text>Drop target</Text></DragDropView>
    <Button disabled={busy} onPress={() => run("desktop.notifications", notificationChecks)}>Check notifications</Button>
    <Button disabled={busy} onPress={() => run("desktop.system", systemChecks)}>Check system and taskbar APIs</Button>
    <Button disabled={busy} onPress={() => run("desktop.modal-windows", modalWindows)}>Check modal window</Button>
    <Button disabled={busy} onPress={() => run("desktop.advanced-menus", advancedMenus)}>Check menu accelerators</Button>
    <Button disabled={busy} onPress={() => run("desktop.tray", tray)}>Check tray</Button>
    <Button disabled={busy} onPress={() => run("desktop.global-shortcuts", globalShortcut)}>Check global shortcut</Button>
    <Button testID="spark-message-dialog" disabled={busy} onPress={() => run("desktop.message-dialog", dialogs)}>Check message dialogs</Button>
    <View ref={anchor} collapsable={false}>
      <Button testID="spark-context-menu" disabled={busy} onPress={() => anchor.current?.measureInWindow((x, y, _width, height) => run("desktop.context-menu", () => menus({ x, y: y + height })))}>Check context menus</Button>
    </View>
  </View>;
}

async function within(action: Promise<void>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([action, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Interaction timed out")), ms); })]); }
  finally { clearTimeout(timer); }
}
