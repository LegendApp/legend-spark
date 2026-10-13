import { runtimeFunction } from "@react-native-runtimes/core";
import { probe } from "./screens/devtools/probe";
import { profilingWorkload } from "./screens/devtools/profiling-workload";

/** The isolated worker runtime the DevTools screen starts; React Native DevTools lists it as its own target. */
export const WORKER = "ks-devtools";
export const workerProbe = runtimeFunction(async (label: string) => probe(label));
/** Profiling: busy JavaScript in the worker runtime, so its own thread shows samples in the trace. */
export const workerWorkload = runtimeFunction(async (milliseconds: number) => profilingWorkload(milliseconds));
/**
 * Profiling: retains an object marked `ks-heap-worker:<tag>` in the worker runtime's heap, for its heap snapshot. The
 * marker is built here and not returned, so no other runtime's heap holds it.
 */
export const workerAllocate = runtimeFunction(async (tag: string) => {
  const marker = `ks-heap-worker:${tag}`;
  (globalThis as { ksHeapMarker?: unknown }).ksHeapMarker = { marker, items: Array.from({ length: 1000 }, (_, index) => ({ index })) };
  return true;
});
