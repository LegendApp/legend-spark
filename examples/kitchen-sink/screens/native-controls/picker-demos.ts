import { useCallback, useEffect, useRef, useState } from "react";
import {
  getColorPanelAvailability, getControlAvailability, getFontPanelAvailability, sampleScreenColor, showColorPanel, showFontPanel,
  type FontDescriptor, type PanelSession, type ResolvedFont,
} from "@legendapp/spark/ui";
import { SparkError } from "@legendapp/spark/contracts";

/** Availability readouts, as JSON, keyed by the testID suffix that shows them. */
export function pickerAvailability() {
  return {
    "date-picker": getControlAvailability("date-picker"), "color-well": getControlAvailability("color-well"),
    "color-panel": getColorPanelAvailability(), sampler: getColorPanelAvailability("sampler"), "font-panel": getFontPanelAvailability(),
  };
}

const describe = (value: unknown) => value instanceof SparkError ? `SparkError:${value.code}` : `Unexpected error: ${String(value)}`;
type Sessions = { color?: PanelSession; font?: PanelSession };

/** Closes whatever panel session the screen still owns when it unmounts. */
function useSessionCleanup(sessions: { current: Sessions }) {
  useEffect(() => () => {
    for (const session of Object.values(sessions.current)) session?.close().catch(console.error);
    sessions.current = {};
  }, [sessions]);
}

/**
 * The screen's panel demos. Each panel keeps its last state for the readouts: `open`, the
 * reason it ended (`dismissed`, `replaced`), `closed`, or a SparkError code.
 */
export function usePanelDemos() {
  const sessions = useRef<Sessions>({});
  useSessionCleanup(sessions);
  const [color, setColor] = useState("#3366ccff");
  const [colorState, setColorState] = useState<string>();
  const [sample, setSample] = useState<string>();
  const [font, setFont] = useState<FontDescriptor | ResolvedFont>({ family: "Helvetica Neue", size: 15, weight: 400, italic: false });
  const [fontState, setFontState] = useState<string>();
  // Only a session this screen opened is closed; with none, the readout keeps its state.
  const close = useCallback(async (panel: keyof Sessions, report: (state: string) => void) => {
    const session = sessions.current[panel];
    if (!session) return;
    try { await session.close(); sessions.current[panel] = undefined; report("closed"); } catch (error) { report(describe(error)); }
  }, []);

  const openColorPanel = useCallback(async () => {
    try {
      const session = await showColorPanel({ color, alpha: true, mode: "wheel", onChange: event => setColor(event.color), onClose: event => setColorState(event.reason) });
      sessions.current.color = session; setColorState("open");
    } catch (error) { setColorState(describe(error)); }
  }, [color]);
  const closeColorPanel = useCallback(() => close("color", setColorState), [close]);
  const sampleColor = useCallback(async () => {
    try { setSample(JSON.stringify(await sampleScreenColor())); } catch (error) { setSample(describe(error)); }
  }, []);
  const openFontPanel = useCallback(async () => {
    try {
      const { family, size, weight, italic } = font;
      const session = await showFontPanel({ font: { family, size, weight, italic }, onChange: event => setFont(event.font), onClose: event => setFontState(event.reason) });
      sessions.current.font = session; setFont(session.font); setFontState("open");
    } catch (error) { setFontState(describe(error)); }
  }, [font]);
  const closeFontPanel = useCallback(() => close("font", setFontState), [close]);
  return { color, colorState, sample, font, fontState, openColorPanel, closeColorPanel, sampleColor, openFontPanel, closeFontPanel };
}
