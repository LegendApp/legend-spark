import { useState } from "react";
import { spring, timing, type MotionAnimationValues, type MotionValues } from "@legendapp/spark/motion";
import type { Way } from "./motion-demo";

// State of the Layout, presence and shared elements screen. Every animation is a MotionView prop: the engine animates
// layout changes natively, MotionPresence keeps removed rows mounted while they exit.

/** Rows enter from the leading side, fade out and shrink on exit; layout moves them with the snappy spring. */
export const rowMotion = (way: Way, added: boolean): { initial?: MotionValues; enter: MotionAnimationValues; exit: MotionAnimationValues } => ({
  initial: added ? { opacity: 0, translateX: -way * 24 } : undefined,
  enter: { opacity: timing(1, { durationMs: 200 }), translateX: spring(0, { preset: "snappy" }) },
  exit: { opacity: timing(0, { durationMs: 200 }), scale: timing(0.9, { durationMs: 200 }) },
});
export const PHOTOS = [1, 2, 3] as const;

/** The rows: the first three were there at mount, later ones are added (and enter). */
export function useRows() {
  const [rows, setRows] = useState({ ids: [1, 2, 3], next: 4 });
  return {
    ids: rows.ids,
    added: (id: number) => id > 3,
    add: () => setRows(({ ids, next }) => ({ ids: [...ids, next], next: next + 1 })),
    removeFirst: () => setRows(({ ids, next }) => ({ ids: ids.slice(1), next })),
    lastToTop: () => setRows(({ ids, next }) => ({ ids: ids.length ? [ids.at(-1)!, ...ids.slice(0, -1)] : ids, next })),
  };
}

/** Which photo is open in the detail view; its thumbnail unmounts, so the detail animates from it (sharedId). */
export function useOpenPhoto() {
  const [open, setOpen] = useState<number>();
  return { open, show: setOpen, close: () => setOpen(undefined) };
}

/** The frame box toggles between a narrow and a wide layout. */
export function useWide() {
  const [wide, setWide] = useState(false);
  return { wide, toggle: () => setWide(value => !value) };
}
