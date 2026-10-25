import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { SparkError, type AsyncRegistration, type Availability } from "@legendapp/spark/contracts";
import {
  createDockMenu, createTaskbarMenu, getSystemAvailability, requestAttention, setAppBadge, setAppProgress,
  type AppProgress, type SystemFeature,
} from "@legendapp/spark/system";
import type { DockTaskbarMessages } from "./dock-taskbar-messages";

export type DemoId =
  | "badge-text" | "badge-count" | "badge-large" | "badge-clear"
  | "progress-35" | "progress-indeterminate" | "progress-paused" | "progress-error" | "progress-invalid" | "progress-clear"
  | "attention-informational" | "attention-critical" | "attention-stop"
  | "launcher-install" | "launcher-remove";
const FEATURES: readonly SystemFeature[] = ["appBadge", "appProgress", "attention", "dockMenu", "taskbarMenu"];
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

/**
 * Badge, progress, attention and the launcher menu through @legendapp/spark/system.
 * Each result is "ok" (or what was requested) or SparkError:<code>. Unmounting cancels a pending
 * attention request, removes the registrations and clears the badge and progress this screen set.
 */
export function useDockTaskbarDemo(t: DockTaskbarMessages) {
  const [results, setResults] = useState<Partial<Record<DemoId, string>>>({});
  const [lastAction, setLastAction] = useState<string>();
  const attention = useRef<AsyncRegistration>(undefined);
  // The launcher menu, pending until creation settles, so Remove and unmount can own it before it arrives.
  const launcher = useRef<Promise<AsyncRegistration>>(undefined);
  // Settles the pending attention delay as cancelled.
  const pending = useRef<() => void>(undefined);
  // Bumped by every attention request, Stop and unmount; a request that finds it changed is stale.
  const generation = useRef(0);
  const badgeSet = useRef(false);
  const progressSet = useRef(false);

  const cancelAttention = useCallback(() => {
    const settle = pending.current;
    pending.current = undefined;
    settle?.();
    return { generation: ++generation.current, cancelled: settle !== undefined };
  }, []);

  const perform = useCallback(async (id: DemoId): Promise<string> => {
    if (id in PROGRESS) {
      const progress = PROGRESS[id]!;
      if (progress) progressSet.current = true;
      await setAppProgress(progress);
      if (!progress) progressSet.current = false;
      return "ok";
    }
    switch (id) {
      case "badge-text": badgeSet.current = true; await setAppBadge(t.badgeText); return "ok";
      case "badge-count": badgeSet.current = true; await setAppBadge(3); return "ok";
      case "badge-large": badgeSet.current = true; await setAppBadge(1250); return "ok";
      case "badge-clear": await setAppBadge(""); badgeSet.current = false; return "ok";
      case "progress-invalid": await setAppProgress({ state: "normal", value: 1.5 }); return "ok";
      case "attention-informational": case "attention-critical": {
        const request = cancelAttention().generation;
        const previous = attention.current; attention.current = undefined;
        await previous?.remove();
        const elapsed = request === generation.current && await new Promise<boolean>(resolve => {
          const timer = setTimeout(() => { pending.current = undefined; resolve(true); }, ATTENTION_DELAY);
          pending.current = () => { clearTimeout(timer); resolve(false); };
        });
        if (!elapsed) return "cancelled";
        const registration = await requestAttention({ kind: id === "attention-critical" ? "critical" : "informational" });
        // Stop, a newer request or unmount arrived while the request was in flight.
        if (request !== generation.current) { await registration.remove(); return "cancelled"; }
        attention.current = registration;
        return "requested";
      }
      case "attention-stop": {
        const { cancelled } = cancelAttention();
        const current = attention.current; attention.current = undefined;
        await current?.remove();
        return current ? "removed" : cancelled ? "cancelled" : "none";
      }
      case "launcher-install": {
        if (!launcher.current) {
          const onAction = ({ itemId }: { itemId: string }) => setLastAction(itemId);
          const newWindow = { type: "action", id: "new-window", label: t.menu.newWindow } as const;
          const mute = { type: "checkbox", id: "mute", label: t.menu.mute, checked: true } as const;
          const created = Platform.OS === "windows"
            ? createTaskbarMenu({ items: [newWindow, mute], onAction })
            : createDockMenu({ items: [
              newWindow, mute, { type: "separator" },
              { type: "submenu", id: "status", label: t.menu.status, items: [{ type: "action", id: "available", label: t.menu.available }, { type: "action", id: "away", label: t.menu.away }] },
            ], onAction });
          launcher.current = created;
          created.catch(() => { if (launcher.current === created) launcher.current = undefined; });
        }
        await launcher.current;
        return "installed";
      }
      case "launcher-remove": {
        const current = launcher.current;
        launcher.current = undefined;
        const registration = await current;
        if (!registration) return "none";
        // A failed removal keeps the registration, so Remove can retry it.
        try { await registration.remove(); } catch (error) { launcher.current ??= current; throw error; }
        return "removed";
      }
    }
    return "ok";
  }, [t, cancelAttention]);

  const run = useCallback(async (id: DemoId) => {
    let result: string;
    try { result = await perform(id); } catch (error) { result = describe(error); }
    setResults(current => ({ ...current, [id]: result }));
  }, [perform]);

  useEffect(() => () => {
    cancelAttention();
    const report = (error: unknown) => console.warn("Dock & taskbar cleanup failed", error);
    attention.current?.remove().catch(report); attention.current = undefined;
    launcher.current?.then(registration => registration.remove()).catch(report); launcher.current = undefined;
    if (badgeSet.current) setAppBadge("").catch(report);
    if (progressSet.current) setAppProgress(null).catch(report);
  }, [cancelAttention]);

  return { availability: dockAvailability(), results, lastAction, run };
}
