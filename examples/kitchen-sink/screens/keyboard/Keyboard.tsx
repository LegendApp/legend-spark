import { addKeyboardListener, KeyText, type KeyboardEvent } from "@legendapp/spark/shortcuts/keyboard";
import { useState } from "react";
import { Button } from "../../Controls";
import { useRegistrations } from "../../shell/registrations";
import { Panel, Status, errorText } from "../../Panel";

const describe = ({ keyCode }: KeyboardEvent) => KeyText[keyCode] ?? `Key ${keyCode}`;

export function Keyboard() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("Enable monitoring, then press keys while this window is focused.");
  useKeyboardMonitor(enabled, setStatus);
  return <Panel title="Keyboard monitor">
    <Status testID="keyboard-keyboard-status">{status}</Status>
    <Button testID="keyboard-keyboard-enable" onPress={() => setEnabled(true)}>Enable monitoring</Button>
    <Button testID="keyboard-keyboard-stop" onPress={() => { setEnabled(false); setStatus("Monitoring stopped."); }}>Stop monitoring</Button>
  </Panel>;
}

function useKeyboardMonitor(enabled: boolean, report: (status: string) => void) {
  useRegistrations(hold => {
    if (!enabled) return;
    hold(addKeyboardListener("down", event => report(`Down: ${describe(event)} modifiers=${event.modifiers}${event.consumed ? " consumed natively" : " observed"}`)));
    hold(addKeyboardListener("up", event => report(`Up: ${describe(event)} modifiers=${event.modifiers}`)));
  }, error => report(errorText(error)), [enabled, report]);
}
