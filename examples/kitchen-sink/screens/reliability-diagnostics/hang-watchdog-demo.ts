import { useCallback, useRef, useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import { getHangWatchdogAvailability, simulateHang, startHangWatchdog, type HangReport, type HangStackFrame } from "@legendapp/spark/diagnostics";
import { useRegistrations } from "../../shell/registrations";

export const THRESHOLDS = [100, 250, 1000] as const;
/** 100 ms stays under every threshold but 100, so it is never reported at 250. */
export const BLOCKS = [100, 500, 1000, 3000] as const;
export type Threshold = (typeof THRESHOLDS)[number];
export type Block = (typeof BLOCKS)[number];
/** Reports kept on screen, newest first. */
const KEEP = 20;

export const availabilityText = () => JSON.stringify(getHangWatchdogAvailability());
const describe = (value: unknown) => value instanceof SparkError ? `SparkError:${value.code}` : value instanceof Error ? `Error: ${value.message}` : String(value);
const isSimulated = (report: HangReport) => report.stack.some(frame => frame.symbol === "SparkSimulateHang");

/** A frame as a crash log shows it: the symbol when known, else image+offset. */
export function frameText(frame: HangStackFrame) {
  const image = frame.image?.split("/").pop();
  const place = frame.symbol ? `${frame.symbol} + ${frame.symbolOffset ?? 0}` : image ? `${image} + ${frame.imageOffset}` : frame.address;
  return `${image ?? "?"}  ${frame.address}  ${place}`;
}

/**
 * How a report of a simulated hang compares with the block that caused it, as JSON for the screen and its
 * flows: the duration is within the watchdog's resolution of the block (it can start up to half a
 * threshold late, and the main thread answers once queued work is done), the stack names
 * SparkSimulateHang, and every frame is located in an image.
 */
export function simulatedCheck(report: HangReport, blockedMs: number) {
  const durationMatches = report.durationMs >= blockedMs - report.thresholdMs / 2 - 25 && report.durationMs <= blockedMs + 250;
  const framesLocated = report.stack.length > 0 && report.stack.every(frame => frame.image !== undefined && frame.imageOffset !== undefined && frame.imageUUID !== undefined);
  return JSON.stringify({ blockedMs, thresholdMs: report.thresholdMs, durationMatches, stackHasSimulateHang: isSimulated(report), framesLocated });
}

/**
 * A watchdog that runs while the screen is open and `watching` is on, restarted when the threshold
 * changes, and main-thread blocks of a chosen length. `simulated` compares the latest report that came
 * from a block with that block.
 */
export function useHangWatchdogDemo() {
  const [thresholdMs, setThreshold] = useState<Threshold>(250);
  const [watching, setWatching] = useState(true);
  const [started, setStarted] = useState<number>();
  const [reports, setReports] = useState<HangReport[]>([]);
  const [simulated, setSimulated] = useState<string>();
  const [error, setError] = useState<string>();
  const [blocking, setBlocking] = useState<Block>();
  const [blockResult, setBlockResult] = useState<string>();
  const lastBlock = useRef<Block>(undefined);

  useRegistrations(hold => {
    setStarted(undefined);
    if (!watching) return;
    hold(startHangWatchdog({
      thresholdMs,
      onHang: report => {
        setReports(current => [report, ...current].slice(0, KEEP));
        if (lastBlock.current !== undefined && isSimulated(report)) setSimulated(simulatedCheck(report, lastBlock.current));
      },
    }).then(watchdog => { setStarted(thresholdMs); setError(undefined); return watchdog; }));
  }, cause => setError(describe(cause)), [watching, thresholdMs]);

  const block = useCallback(async (ms: Block) => {
    lastBlock.current = ms;
    setBlocking(ms);
    try { await simulateHang(ms); setBlockResult(`blocked ${ms}`); }
    catch (cause) { setBlockResult(describe(cause)); }
    finally { setBlocking(undefined); }
  }, []);
  const clear = useCallback(() => { setReports([]); setSimulated(undefined); setBlockResult(undefined); }, []);

  const state = error ?? (!watching ? "stopped" : started === undefined ? "starting" : `watching ${started}`);
  return { thresholdMs, setThreshold, watching, setWatching, state, reports, simulated, blocking, blockResult, block, clear };
}
