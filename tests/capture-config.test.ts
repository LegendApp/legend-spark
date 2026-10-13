import { createRequire } from "node:module";
import { expect, test } from "vitest";
import { toExpo } from "@legendapp/spark-desktop-config/config.cjs";
// macos.capture: the opt-in camera and microphone entitlements, and the usage descriptions they need.
const require = createRequire(import.meta.url);
const { resolveEntitlements, captureEntitlements } = require("../packages/config-plugin/entitlements.cjs");
const usage = { NSCameraUsageDescription: "Shows you in calls.", NSMicrophoneUsageDescription: "Records voice notes." };
const app = (macos: Record<string, unknown>) => ({ name: "Demo", projectId: "demo", version: "1.0.0", macos: { bundleIdentifier: "com.example.demo", ...macos } });

test("capture entitlements are added only when the app opts in", () => {
  expect(captureEntitlements(undefined)).toEqual({});
  expect(captureEntitlements({ camera: false, microphone: false })).toEqual({});
  expect(captureEntitlements({ camera: true })).toEqual({ "com.apple.security.device.camera": true });
  expect(captureEntitlements({ microphone: true })).toEqual({ "com.apple.security.device.audio-input": true });
  // The media package declares none: an app that installs it without macos.capture gets no entitlement.
  const media = require("../packages/media/package.json");
  expect(media.spark.entitlements).toBeUndefined();
  expect(resolveEntitlements({ macos: {} }, [media])).toEqual({});
  expect(resolveEntitlements({ macos: { capture: { camera: true, microphone: true }, entitlements: { "com.apple.security.network.client": true } } }, [media]))
    .toEqual({ "com.apple.security.device.camera": true, "com.apple.security.device.audio-input": true, "com.apple.security.network.client": true });
});

test("capture and authentication entitlements resolve together", () => {
  expect(resolveEntitlements({ macos: { capture: { microphone: true }, authentication: { signInWithApple: true, passkeyDomains: ["example.com"] } } }, [])).toEqual({
    "com.apple.security.device.audio-input": true,
    "com.apple.developer.applesignin": ["Default"],
    "com.apple.developer.associated-domains": ["webcredentials:example.com"],
  });
  expect(toExpo(app({ capture: { camera: true }, authentication: { signInWithApple: true }, infoPlist: usage })).expo.macos).toMatchObject({ capture: { camera: true }, authentication: { signInWithApple: true } });
});

test("macos.capture is validated and needs each usage description", () => {
  expect(toExpo(app({ capture: { camera: true, microphone: true }, infoPlist: usage })).expo.macos?.capture).toEqual({ camera: true, microphone: true });
  expect(() => toExpo(app({ capture: { camera: true }, infoPlist: { NSMicrophoneUsageDescription: "x" } }))).toThrow("macos.capture.camera needs macos.infoPlist.NSCameraUsageDescription");
  expect(() => toExpo(app({ capture: { microphone: true }, infoPlist: { NSMicrophoneUsageDescription: " " } }))).toThrow("NSMicrophoneUsageDescription");
  expect(() => toExpo(app({ capture: { camera: "yes" }, infoPlist: usage }))).toThrow("macos.capture.camera must be a boolean");
  expect(() => toExpo(app({ capture: { screen: true } }))).toThrow("Unknown macos.capture field: screen");
  expect(toExpo(app({ capture: { camera: false } })).expo.macos?.capture).toEqual({ camera: false });
});

test("the Kitchen Sink stays unentitled", () => {
  const ks = require("../examples/kitchen-sink/desktop.config.json");
  expect(ks.macos.capture).toBeUndefined();
  expect(ks.macos.entitlements).toBeUndefined();
});
