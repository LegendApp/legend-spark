import { getWindow, setWindowBounds, type WindowBounds } from "@legendapp/spark/windows";
import { useCallback, useEffect, useState } from "react";
import { Dimensions, useWindowDimensions } from "react-native";
import { Button } from "../../Controls";
import { Panel, Status, errorText } from "../../Panel";

// Test IDs: windows-window-dimensions-fits once Dimensions' window matches the main window's content (its frame
// width, its frame height less at most the title bar) and is not the display; windows-window-dimensions-updated once
// the screen's own resize (once, after the first match) reaches useWindowDimensions with the new width.
const ID = "windows-window-dimensions";
const size = (value: { width: number; height: number }) => `${Math.round(value.width)}×${Math.round(value.height)}`;
const fits = (window: { width: number; height: number }, bounds: WindowBounds) =>
  Math.round(window.width) === Math.round(bounds.width) && window.height <= bounds.height && window.height >= bounds.height - 60;

export function WindowDimensionsDemo() {
  const window = useWindowDimensions();
  const screen = Dimensions.get("screen");
  const [bounds, setBounds] = useState<WindowBounds | null>(null);
  const [requested, setRequested] = useState<number | null>(null);
  const [status, setStatus] = useState("Reading the main window.");
  const report = useCallback((error: unknown) => setStatus(errorText(error)), []);
  useEffect(() => { getWindow("main").then(main => setBounds(main.bounds), report); }, [window.width, window.height, report]);
  const resize = useCallback(() => {
    if (!bounds) return;
    const width = Math.round(bounds.width) + (bounds.width > 900 ? -80 : 80);
    setRequested(width);
    setWindowBounds("main", { ...bounds, width }).then(() => setStatus(`Resized to ${width} wide`), report);
  }, [bounds, report]);
  const matches = bounds !== null && fits(window, bounds) && (window.width !== screen.width || window.height !== screen.height);
  const updated = requested !== null && Math.round(window.width) === requested;
  // The driver can't press buttons: resize once by itself after the first match.
  useEffect(() => { if (matches && requested === null) resize(); }, [matches, requested, resize]);
  return <Panel title="Window dimensions">
    <Status testID={`${ID}-window`}>{`Dimensions window ${size(window)} @${window.scale}x`}</Status>
    <Status testID={`${ID}-screen`}>{`Dimensions screen ${size(screen)}`}</Status>
    <Status testID={`${ID}-frame`}>{bounds ? `Main window frame ${size(bounds)} on display ${bounds.displayId}` : "Main window frame unknown"}</Status>
    <Status testID={matches ? `${ID}-fits` : `${ID}-mismatch`}>{matches ? "Window size matches the window's content" : "Window size does not match the window"}</Status>
    <Status testID={updated ? `${ID}-updated` : `${ID}-status`}>{updated ? `Change event: ${size(window)}` : status}</Status>
    <Button testID={`${ID}-resize`} onPress={resize}>Resize main window</Button>
  </Panel>;
}
