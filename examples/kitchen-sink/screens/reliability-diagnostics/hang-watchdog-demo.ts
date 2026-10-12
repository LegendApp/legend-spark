import { useCallback, useState } from "react";
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

/** A block of the main thread: its length, and wall-clock times taken just before the call and once it resolved. */
export type BlockWindow = { blockedMs: number; before: number; after: number };

/**
 * How a report of a simulated hang compares with the block that caused it, as JSON for the screen and its
 * flows. The timing bounds hold however late the machine runs anything: the unanswered ping went out
 * once the block was asked for (50 ms of slack for a ping already queued) and at least a threshold
 * before it resolved; it was answered after the block's full length and well within a second of the
 * call resolving; and the hang lasted at least the threshold. 20 ms allows for comparing the wall clock
 * with the watchdog's uptime clock. The stack names SparkSimulateHang, and every frame is located in an image.
 */
export function simulatedCheck(report: HangReport, { blockedMs, before, after }: BlockWindow) {
  const answeredAt = report.startedAt + report.durationMs;
  const durationMatches = report.startedAt >= before - 50 && report.startedAt <= after - report.thresholdMs
    && report.durationMs >= report.thresholdMs && answeredAt >= before + blockedMs - 20 && answeredAt <= after + 1000;
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
  const [simulatedReport, setSimulatedReport] = useState<HangReport>();
  const [blockWindow, setBlockWindow] = useState<BlockWindow>();
  const [error, setError] = useState<string>();
  const [blocking, setBlocking] = useState<Block>();
  const [blockResult, setBlockResult] = useState<string>();

  useRegistrations(hold => {
    setStarted(undefined);
    if (!watching) return;
    hold(startHangWatchdog({
      thresholdMs,
      onHang: report => {
        setReports(current => [report, ...current].slice(0, KEEP));
        if (isSimulated(report)) setSimulatedReport(report);
      },
    }).then(watchdog => { setStarted(thresholdMs); setError(undefined); return watchdog; }));
  }, cause => setError(describe(cause)), [watching, thresholdMs]);

  const block = useCallback(async (ms: Block) => {
    setBlocking(ms);
    setSimulatedReport(undefined);
    setBlockWindow(undefined);
    const before = Date.now();
    try { await simulateHang(ms); setBlockWindow({ blockedMs: ms, before, after: Date.now() }); setBlockResult(`blocked ${ms}`); }
    catch (cause) { setBlockResult(describe(cause)); }
    finally { setBlocking(undefined); }
  }, []);
  const clear = useCallback(() => { setReports([]); setSimulatedReport(undefined); setBlockResult(undefined); }, []);

  // The report can arrive before or after the block's call resolves; the check needs both.
  const simulated = simulatedReport && blockWindow ? simulatedCheck(simulatedReport, blockWindow) : undefined;
  const state = error ?? (!watching ? "stopped" : started === undefined ? "starting" : `watching ${started}`);
  return { thresholdMs, setThreshold, watching, setWatching, state, reports, simulated, blocking, blockResult, block, clear };
}
