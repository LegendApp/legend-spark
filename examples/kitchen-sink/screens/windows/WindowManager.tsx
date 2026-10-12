import { addAppListener } from "@legendapp/spark/app";
import { addWindowListener, closeWindow, getWindow, openWindow, setWindowBounds, setWindowOptions, showWindow, type WindowBounds } from "@legendapp/spark/windows";
import { setWindowBlur } from "@legendapp/spark/windows/macos";
import { useCallback, useState } from "react";
import { Button } from "../../Controls";
import { useRegistrations } from "../../shell/registrations";
import { Panel, Status, errorText } from "../../Panel";

// The child is a secondary root of this bundle; App renders windowProps.message for it.
const CHILD = "windows-window-manager-child";
const frameText = (frame: WindowBounds) => `${frame.displayId}: ${Math.round(frame.x)}, ${Math.round(frame.y)} ${Math.round(frame.width)}x${Math.round(frame.height)}`;

export function WindowManager() {
  const [status, setStatus] = useState("Open a child window to test the window API.");
  const [bounds, setBounds] = useState<WindowBounds | null>(null);
  const report = useCallback((error: unknown) => setStatus(errorText(error)), []);
  const run = (label: string, operation: () => Promise<unknown>) => { operation().then(() => setStatus(label), report); };
  useMainWindowEvents(setStatus, setBounds, report);
  return <Panel title="Window manager">
    <Status testID="windows-window-manager-status">{status}</Status>
    <Status testID="windows-window-manager-frame">Frame: {bounds ? frameText(bounds) : "Unknown"}</Status>
    <Button testID="windows-window-manager-open" onPress={() => run("Opened child", () => openWindow({ id: CHILD, component: "main", title: "Window Manager Child", props: { windowId: CHILD, windowProps: { message: "Opened from the Kitchen Sink window manager." } }, size: { width: 460, height: 300 }, minSize: { width: 320, height: 220 }, macos: { titleBar: { contentLayout: "fullSize", transparent: true, material: "glass" }, toolbar: { visible: true, style: "unified" } } }))}>Open child window</Button>
    <Button testID="windows-window-manager-update" onPress={() => run("Updated child", async () => { const window = await getWindow(CHILD); await setWindowBounds(CHILD, { ...window.bounds, width: 540, height: 360 }); await setWindowOptions(CHILD, { title: "Updated Child Window", minSize: { width: 360, height: 240 } }); })}>Update existing window</Button>
    <Button testID="windows-window-manager-rename" onPress={() => run("Renamed child", () => setWindowOptions(CHILD, { title: "Renamed from JS" }))}>Rename child</Button>
    <Button testID="windows-window-manager-blur" onPress={() => run("Blurred child", () => setWindowBlur(CHILD, { radius: 8, durationMs: 250 }))}>Blur child</Button>
    <Button testID="windows-window-manager-clear-blur" onPress={() => run("Cleared blur", () => setWindowBlur(CHILD, { radius: 0, durationMs: 250 }))}>Clear blur</Button>
    <Button testID="windows-window-manager-close" onPress={() => { closeWindow(CHILD).then(result => setStatus(result.closed ? "Closed child" : "Close vetoed"), report); }}>Close child</Button>
    <Button testID="windows-window-manager-show-main" onPress={() => run("Showing main", () => showWindow("main"))}>Show main window</Button>
    <Button testID="windows-window-manager-read-frame" onPress={() => run("Read frame", async () => setBounds((await getWindow("main")).bounds))}>Read frame</Button>
    <Button testID="windows-window-manager-normalize" onPress={() => run("Normalized main size", async () => { const window = await getWindow("main"); const next = { ...window.bounds, width: Math.max(760, window.bounds.width), height: Math.max(520, window.bounds.height) }; await setWindowBounds("main", next); setBounds(next); })}>Normalize main size</Button>
  </Panel>;
}

function useMainWindowEvents(setStatus: (status: string) => void, setBounds: (bounds: WindowBounds) => void, report: (error: unknown) => void) {
  useRegistrations(hold => {
    let active = true;
    hold({ remove() { active = false; } });
    hold(addAppListener("windowClosed", event => setStatus(`Closed: ${event.windowId}`)));
    hold(addWindowListener("main", "focusChanged", event => setStatus(`Focused: ${event.focused}`)));
    hold(addWindowListener("main", "boundsChanged", event => setBounds(event.bounds)));
    getWindow("main").then(window => { if (active) setBounds(window.bounds); }, report);
  }, report, [setStatus, setBounds, report]);
}
