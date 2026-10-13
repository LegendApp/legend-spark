import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { AppRegistry, type View } from "react-native";
import { SparkError } from "@legendapp/spark/contracts";
import { getMotionEnvironment, getMotionState, type MotionTarget } from "@legendapp/spark/motion";
import { onSystemEvent } from "@legendapp/spark/system";
import { closeWindow, getWindow, openWindowFrom } from "@legendapp/spark/windows";
import type { Locale } from "../../shell/i18n";
// The photo window's root imports this module back; it is only read when a window opens.
import { SharedPhotoWindow } from "./SharedPhotoWindow";

/**
 * Motion system > Cross-window shared elements (docs/motion.md#cross-window-shared-elements): a thumbnail opens a photo
 * window that zooms out of it while the photo flies from the thumbnail into the window; closing the window flies the
 * photo back into its thumbnail as the window shrinks into it. Both views are MotionViews with the same sharedId and
 * sharedAcrossWindows. The readout polls what the engine reports for the photo and its thumbnail (moving or still,
 * scale, opacity), so driver flows, which never show windows, check the hand-offs on the virtual clock.
 */
export const PHOTOS = [1, 2, 3] as const;
export type Photo = typeof PHOTOS[number];
export const PHOTO_WINDOW = "ks-shared-photo";
export const PHOTO_COMPONENT = "KitchenSinkSharedPhoto";
export const sharedId = (photo: number) => `motion-system-shared-windows-photo-${photo}`;
const TONES = ["bg-success", "bg-danger", "bg-accent-primary"] as const;
export const tone = (photo: number) => TONES[(photo - 1) % TONES.length];
/** A view's motion as the readout shows it; `scale` reads `between` while it is neither at an end nor at rest. */
export type ViewMotion = { moving: boolean; scale: string; opacity: string } | null;
export type SharedWindowsState = { reduceMotion: boolean | null; window: "open" | "closed"; photo: ViewMotion; thumbs: Record<Photo, ViewMotion>; error: string | null };

let state: SharedWindowsState = { reduceMotion: null, window: "closed", photo: null, thumbs: { 1: null, 2: null, 3: null }, error: null };
const listeners = new Set<() => void>();
const update = (change: Partial<SharedWindowsState>) => { state = { ...state, ...change }; for (const listener of listeners) listener(); };
const report = (error: unknown) => update({ error: error instanceof SparkError ? `${error.code}: ${error.message}` : String(error) });

// The thumbnails' containers (for the zoom's source rectangle) and the MotionViews, registered while mounted. The photo
// window renders in its own React root of the same JavaScript runtime and registers its photo here too.
const thumbs = new Map<Photo, { frame: RefObject<View | null>; target: RefObject<MotionTarget | null> }>();
let photo: RefObject<MotionTarget | null> | undefined;
function registerThumb(id: Photo, frame: RefObject<View | null>, target: RefObject<MotionTarget | null>) {
  thumbs.set(id, { frame, target });
  return () => { if (thumbs.get(id)?.target === target) thumbs.delete(id); };
}
function registerPhoto(target: RefObject<MotionTarget | null>) {
  photo = target;
  return () => { if (photo === target) photo = undefined; };
}

const ENDS = [0.2, 1, 5];
async function describe(target: MotionTarget | null | undefined): Promise<ViewMotion> {
  if (!target) return null;
  try {
    const { values, animating } = await getMotionState(target);
    const end = ENDS.find(value => Math.abs(values.scaleX - value) < 0.005);
    return { moving: animating.some(property => property.startsWith("translate") || property.startsWith("scale")), scale: end === undefined ? "between" : end.toFixed(2), opacity: values.opacity.toFixed(2) };
  } catch (error) {
    if (error instanceof SparkError && error.code === "E_NOT_FOUND") return null;
    throw error;
  }
}
// The latest refresh wins: an earlier read that resolves late never overwrites it.
let refreshes = 0;
export async function refresh() {
  const ticket = ++refreshes;
  const [window, current, ...thumbStates] = await Promise.all([
    getWindow(PHOTO_WINDOW).then(info => info.visible ? "open" as const : "closed" as const, (error: unknown) => {
      if (error instanceof SparkError && error.code === "E_NOT_FOUND") return "closed" as const;
      throw error;
    }),
    describe(photo?.current), ...PHOTOS.map(id => describe(thumbs.get(id)?.target.current)),
  ]);
  if (ticket === refreshes) update({ window, photo: window === "open" ? current : null, thumbs: Object.fromEntries(PHOTOS.map((id, index) => [id, thumbStates[index]])) as SharedWindowsState["thumbs"] });
}

function measure(id: Photo): Promise<{ windowId: string; x: number; y: number; width: number; height: number }> {
  const view = thumbs.get(id)?.frame.current;
  if (!view) return Promise.reject(new Error(`Thumbnail ${id} is not on screen`));
  return new Promise(resolve => view.measureInWindow((x, y, width, height) => resolve({ windowId: "main", x, y, width, height })));
}
// The photo window's React root, registered before the first photo window opens.
let registered = false;
function registerPhotoWindow() {
  if (registered) return;
  registered = true;
  AppRegistry.registerComponent(PHOTO_COMPONENT, () => SharedPhotoWindow);
}
/** Opens the photo window out of its thumbnail; it shrinks back into it when it closes. One photo window at a time: close it first. */
export async function openPhoto(id: Photo, locale: Locale, title: string) {
  update({ error: null });
  try {
    registerPhotoWindow();
    const zoom = await openWindowFrom({ id: PHOTO_WINDOW, component: PHOTO_COMPONENT, title, props: { photo: id, locale }, size: { width: 360, height: 240 } },
      { from: await measure(id), focusOnClose: "main", transition: { durationMs: 300, easing: "easeOut" } });
    zoom.finished.catch(report);
  } catch (error) { report(error); }
  await refresh().catch(report);
}
export async function closePhoto() {
  update({ error: null });
  try { await closeWindow(PHOTO_WINDOW); }
  catch (error) { if (!(error instanceof SparkError && error.code === "E_NOT_FOUND")) report(error); }
  await refresh().catch(report);
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const readReduceMotion = () => { getMotionEnvironment().then(({ reduceMotion }) => update({ reduceMotion })).catch(report); };
/**
 * The readout, polled every 100 ms while the screen shows (hand-offs start when the photo mounts in its window), and the
 * Reduce Motion setting motion follows, read again after each accessibility display change.
 */
export function useSharedWindows() {
  useEffect(() => {
    const timer = setInterval(() => { refresh().catch(report); }, 100);
    readReduceMotion();
    const registration = onSystemEvent(readReduceMotion, { types: ["accessibilityDisplayChanged"], onError: report });
    registration.catch(report);
    return () => { clearInterval(timer); registration.then(item => item.remove()).catch(report); };
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}
/** Registers a thumbnail while it is mounted. */
export function useThumb(id: Photo, frame: RefObject<View | null>, target: RefObject<MotionTarget | null>) {
  useEffect(() => registerThumb(id, frame, target), [id, frame, target]);
}
/** Registers the photo window's photo while it is mounted. */
export function usePhoto(target: RefObject<MotionTarget | null>) {
  useEffect(() => registerPhoto(target), [target]);
}
