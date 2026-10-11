import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as app from "@legendapp/spark/app";
import { SparkError, type AsyncRegistration, type Availability } from "@legendapp/spark/contracts";
import {
  createDockMenu, createTaskbarMenu, createThumbnailToolbar, getSystemAvailability, requestAttention, setAppBadge, setAppProgress,
  type AppProgress, type SystemFeature,
} from "@legendapp/spark/system";
import type { DockTaskbarMessages } from "./dock-taskbar-messages";

export type DemoId =
  | "badge-text" | "badge-count" | "badge-large" | "badge-clear"
  | "progress-35" | "progress-indeterminate" | "progress-paused" | "progress-error" | "progress-invalid" | "progress-clear"
  | "attention-informational" | "attention-critical" | "attention-stop"
  | "launcher-install" | "launcher-remove" | "thumbnail";
const FEATURES: readonly SystemFeature[] = ["appBadge", "appProgress", "attention", "dockMenu", "taskbarMenu", "thumbnailToolbar"];
const PROGRESS: Partial<Record<DemoId, AppProgress | null>> = {
  "progress-35": { state: "normal", value: 0.35 }, "progress-indeterminate": { state: "indeterminate" },
  "progress-paused": { state: "paused", value: 0.6 }, "progress-error": { state: "error", value: 0.8 }, "progress-clear": null,
};
// Attention only reaches an inactive app, so requests wait for the user to switch away.
const ATTENTION_DELAY = 3000;

/** Availability readouts, keyed by the testID suffix that shows them. */
export function dockAvailability(): Record<string, Availability> {
  return Object.fromEntries([["system", getSystemAvailability()], ...FEATURES.map(feature => [feature, getSystemAvailability(feature)])]);
}
const describe = (value: unknown) => value instanceof SparkError ? `SparkError:${value.code}` : value instanceof Error ? `Error: ${value.message}` : String(value);

async function thumbnailIcon(name: string) {
  // Any absolute path: the call validates the buttons, then rejects until #301, before reading a file.
  const executable = (await app.getAppContext()).launchArguments[0] ?? "";
  const separator = Platform.OS === "windows" ? "\\" : "/";
  return `${executable.slice(0, executable.lastIndexOf(separator))}${separator}${name}.ico`;
}

/**
 * Badge, progress, attention, the launcher menu and the thumbnail toolbar through @legendapp/spark/system.
 * Each result is "ok" (or what was requested) or SparkError:<code>. Unmounting removes the
 * registrations and clears the badge and progress this screen set.
 */
export function useDockTaskbarDemo(t: DockTaskbarMessages) {
  const [results, setResults] = useState<Partial<Record<DemoId, string>>>({});
  const [lastAction, setLastAction] = useState<string>();
  const attention = useRef<AsyncRegistration>(undefined);
  const launcher = useRef<AsyncRegistration>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const perform = useCallback(async (id: DemoId): Promise<string> => {
    if (id in PROGRESS) { await setAppProgress(PROGRESS[id]!); return "ok"; }
    switch (id) {
      case "badge-text": await setAppBadge(t.badgeText); return "ok";
      case "badge-count": await setAppBadge(3); return "ok";
      case "badge-large": await setAppBadge(1250); return "ok";
      case "badge-clear": await setAppBadge(""); return "ok";
      case "progress-invalid": await setAppProgress({ state: "normal", value: 1.5 }); return "ok";
      case "attention-informational": case "attention-critical": {
        await attention.current?.remove();
        await new Promise(resolve => { timer.current = setTimeout(resolve, ATTENTION_DELAY); });
        attention.current = await requestAttention({ kind: id === "attention-critical" ? "critical" : "informational" });
        return "requested";
      }
      case "attention-stop": {
        clearTimeout(timer.current);
        const current = attention.current; attention.current = undefined;
        await current?.remove();
        return current ? "removed" : "none";
      }
      case "launcher-install": {
        if (launcher.current) return "installed";
        const onAction = ({ itemId }: { itemId: string }) => setLastAction(itemId);
        const newWindow = { type: "action", id: "new-window", label: t.menu.newWindow } as const;
        const mute = { type: "checkbox", id: "mute", label: t.menu.mute, checked: true } as const;
        launcher.current = Platform.OS === "windows"
          ? await createTaskbarMenu({ items: [newWindow, mute], recentDocuments: true, onAction })
          : await createDockMenu({ items: [
            newWindow, mute, { type: "separator" },
            { type: "submenu", id: "status", label: t.menu.status, items: [{ type: "action", id: "available", label: t.menu.available }, { type: "action", id: "away", label: t.menu.away }] },
          ], onAction });
        return "installed";
      }
      case "launcher-remove": {
        const current = launcher.current;
        await current?.remove();
        launcher.current = undefined;
        return current ? "removed" : "none";
      }
      case "thumbnail": {
        const [play, next] = await Promise.all([thumbnailIcon("play"), thumbnailIcon("next")]);
        await createThumbnailToolbar({ buttons: [{ id: "play", tooltip: t.thumbnail.play, icon: play }, { id: "next", tooltip: t.thumbnail.next, icon: next }], onAction: ({ itemId }) => setLastAction(itemId) });
        return "installed";
      }
    }
    return "ok";
  }, [t]);

  const run = useCallback(async (id: DemoId) => {
    let result: string;
    try { result = await perform(id); } catch (error) { result = describe(error); }
    setResults(current => ({ ...current, [id]: result }));
  }, [perform]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    const report = (error: unknown) => console.warn("Dock & taskbar cleanup failed", error);
    attention.current?.remove().catch(report); attention.current = undefined;
    launcher.current?.remove().catch(report); launcher.current = undefined;
    setAppBadge("").catch(report);
    setAppProgress(null).catch(report);
  }, []);

  return { availability: dockAvailability(), results, lastAction, run };
}
