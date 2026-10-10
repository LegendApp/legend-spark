import { addWindowListener, getWindow, setWindowOptions } from "@legendapp/spark/windows";
import { useCallback, useState } from "react";
import { Button } from "../../Controls";
import { useRegistrations } from "../../shell/registrations";
import { Panel, Status, errorText } from "../../Panel";

const fullscreenText = (fullscreen: boolean) => `Fullscreen: ${fullscreen ? "Yes" : "No"}`;

export function WindowControls() {
  const [status, setStatus] = useState("Fullscreen status unknown.");
  const report = useCallback((error: unknown) => setStatus(errorText(error)), []);
  const refresh = () => getWindow("main").then(window => setStatus(fullscreenText(window.fullscreen)), report);
  useFullscreenStatus(setStatus, report);
  return <Panel title="Window controls">
    <Status testID="windows-window-controls-status">{status}</Status>
    <Button testID="windows-window-controls-hide" onPress={() => { setWindowOptions("main", { macos: { titleBar: { trafficLights: false } } }).catch(report); }}>Hide controls</Button>
    <Button testID="windows-window-controls-show" onPress={() => { setWindowOptions("main", { macos: { titleBar: { trafficLights: true } } }).catch(report); }}>Show controls</Button>
    <Button testID="windows-window-controls-check" onPress={() => void refresh()}>Check fullscreen</Button>
  </Panel>;
}

function useFullscreenStatus(setStatus: (status: string) => void, report: (error: unknown) => void) {
  useRegistrations(hold => {
    let active = true;
    hold({ remove() { active = false; } });
    hold(addWindowListener("main", "fullscreenChanged", event => setStatus(fullscreenText(event.fullscreen))));
    getWindow("main").then(window => { if (active) setStatus(fullscreenText(window.fullscreen)); }, report);
  }, report, [setStatus, report]);
}
