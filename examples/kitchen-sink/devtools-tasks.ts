import { runtimeFunction } from "@react-native-runtimes/core";
import { probe } from "./screens/devtools/probe";

// Development runtime discovery scans top-level files, so the DevTools screen's worker function lives here.
/** The isolated worker runtime the DevTools screen starts; React Native DevTools lists it as its own target. */
export const WORKER = "ks-devtools";
export const workerProbe = runtimeFunction(async (label: string) => probe(label));
