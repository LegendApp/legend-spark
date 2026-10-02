import { NativeEventEmitter, TurboModuleRegistry } from "react-native";
import type { Spec } from "./NativeDesktopApp";
import { SparkError, type Subscription } from "./contracts";
/** Internal bridge transport. Feature modules validate their own event payloads. */
export type DesktopEvent = { type: string; id?: string; url?: string; windowId?: string; bytes?: ArrayBuffer; [key: string]: unknown };
export interface DesktopEventFilter { types: readonly string[]; target?: { field: string; value: string } }
type Entry = { active: boolean; listener: (event: DesktopEvent) => void };
type Bucket = { count: number; listeners: Entry[]; targets: Map<string, Map<string, Entry[]>> };
type Hub = { count: number; buckets: Map<string, Bucket>; subscription: Subscription };
const hubs = new WeakMap<Spec, Hub>();
function deliver(listeners: readonly Entry[], event: DesktopEvent) {
  // Arrays are replaced on registration, so dispatch needs no per-event snapshot.
  // One throwing subscriber must not starve the rest of the bucket or escape into the native emitter.
  for (const entry of listeners) {
    if (!entry.active) continue;
    try { entry.listener(event); }
    catch (cause) { console.error(new SparkError("E_NATIVE", "Desktop event listener failed", { cause })); }
  }
}
function route(bucket: Bucket | undefined, event: DesktopEvent) {
  if (!bucket) return;
  deliver(bucket.listeners, event);
  for (const [field, targets] of bucket.targets) {
    const value = event[field];
    const listeners = typeof value === "string" ? targets.get(value) : undefined;
    if (listeners) deliver(listeners, event);
  }
}
function dispatch(hub: Hub, event: DesktopEvent) {
  route(hub.buckets.get(event.type), event);
  if (event.type !== "*") route(hub.buckets.get("*"), event);
}
/** Route once by native event type/resource instead of waking every feature listener. */
export function onDesktopEvent(listener: (event: DesktopEvent) => void, filter?: DesktopEventFilter): Subscription {
  const native = TurboModuleRegistry.get<Spec>("NativeDesktopApp");
  if (!native) throw new SparkError("E_MODULE_UNAVAILABLE", "Desktop event module is unavailable");
  let hub = hubs.get(native);
  if (!hub) {
    const created: Hub = { count: 0, buckets: new Map(), subscription: undefined! };
    created.subscription = new NativeEventEmitter(native).addListener("desktop", (event: unknown) => {
      if (event && typeof event === "object" && typeof (event as DesktopEvent).type === "string") dispatch(created, event as DesktopEvent);
    });
    hubs.set(native, created); hub = created;
  }
  const owner = hub, entry: Entry = { active: true, listener };
  const types = filter ? [...new Set(filter.types)] : ["*"];
  const target = filter?.target ? { ...filter.target } : undefined;
  owner.count++;
  for (const type of types) {
    const bucket = owner.buckets.get(type) ?? { count: 0, listeners: [], targets: new Map() };
    owner.buckets.set(type, bucket); bucket.count++;
    if (!target) bucket.listeners = [...bucket.listeners, entry];
    else {
      const values = bucket.targets.get(target.field) ?? new Map<string, Entry[]>();
      bucket.targets.set(target.field, values);
      values.set(target.value, [...(values.get(target.value) ?? []), entry]);
    }
  }
  return { remove() {
    if (!entry.active) return;
    entry.active = false;
    for (const type of types) {
      const bucket = owner.buckets.get(type)!;
      if (!target) bucket.listeners = bucket.listeners.filter(value => value !== entry);
      else {
        const values = bucket.targets.get(target.field)!;
        const remaining = values.get(target.value)!.filter(value => value !== entry);
        if (remaining.length) values.set(target.value, remaining); else values.delete(target.value);
        if (!values.size) bucket.targets.delete(target.field);
      }
      if (--bucket.count === 0) owner.buckets.delete(type);
    }
    if (--owner.count === 0) { owner.subscription.remove(); hubs.delete(native); }
  } };
}
