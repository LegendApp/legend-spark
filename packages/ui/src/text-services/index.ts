import { findNodeHandle, Platform, type Text, type TextInput } from "react-native";
import type { ComponentRef } from "react";
import { SparkError, invokeNative, parseNativeResult, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import NativeSparkTextServices, { type Spec } from "./NativeSparkTextServices";

/**
 * Text services of AppKit text views, on macOS:
 * - `services`: the Services menu (app menu and context menu) for selected text. Text views send the selection and
 *   accept a service's returned text through AppKit's requestor protocol; no Spark call is needed.
 * - `lookUp`: Look Up and Force Click definitions (built in), and `lookUp(target)`.
 * - `writingTools`: Writing Tools (Apple Intelligence). Supported on macOS 15.2+ hardware that runs it, even when the
 *   user has not turned it on. Set `writingToolsBehavior` on a React Native `TextInput` to opt an input in or out.
 * - `findBar`: the NSTextFinder find bar in multiline `TextInput`s (Edit > Find), `showFindBar` and `findText`.
 */
export type TextServicesFeature = "services" | "lookUp" | "writingTools" | "findBar";
/** AppKit's NSWritingToolsBehavior. `complete` and `limited` are preferences the system applies when it can. */
export type WritingToolsBehavior = "default" | "complete" | "limited" | "none";
/** A mounted multiline React Native `TextInput`, or a `Text` with `selectable`. */
export type TextServicesTarget = ComponentRef<typeof TextInput> | ComponentRef<typeof Text>;
export interface FindTextOptions {
  /** Match letter case. Default false. */
  caseSensitive?: boolean;
  /** Continue from the other end when no match follows the selection. Default true. */
  wrap?: boolean;
  /** Select the match before the selection instead of after it. Default false. */
  backwards?: boolean;
}
export interface FindTextResult {
  /** Non-overlapping matches in the whole text. */
  matchCount: number;
  /** 1-based position of the match now selected; 0 when none was selected (no match, or none further without `wrap`). */
  matchIndex: number;
}

declare module "react-native" {
  interface TextInputProps {
    /** macOS 15+ Writing Tools for this input (Spark config plugin). Default `"default"`; other platforms ignore it. */
    writingToolsBehavior?: WritingToolsBehavior;
  }
}

const features: readonly TextServicesFeature[] = ["services", "lookUp", "writingTools", "findBar"];
export function getTextServicesAvailability(feature: TextServicesFeature): Availability {
  if (!features.includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown text services feature");
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  if (feature === "services") return { available: true };
  if (!NativeSparkTextServices) return { available: false, reason: "missing-module" };
  if (feature === "writingTools" && !NativeSparkTextServices.isWritingToolsAvailable()) return { available: false, reason: "host-restriction" };
  return { available: true };
}

function native(feature: TextServicesFeature): Spec {
  const availability = getTextServicesAvailability(feature);
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `Text services are unavailable: ${availability.reason}`);
  return NativeSparkTextServices!;
}
function tagOf(target: TextServicesTarget | null | undefined): number {
  if (!target || typeof target !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Expected a mounted TextInput or Text ref");
  const tag = findNodeHandle(target);
  if (typeof tag !== "number") throw new SparkError("E_NOT_FOUND", "The text services target is not mounted");
  return tag;
}
function flag(options: FindTextOptions, key: keyof FindTextOptions, fallback: boolean) {
  const value = options[key];
  if (value !== undefined && typeof value !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", `${key} must be a boolean`);
  return value ?? fallback;
}
const isFindResult = (value: unknown): value is FindTextResult => !!value && typeof value === "object"
  && Number.isSafeInteger((value as FindTextResult).matchCount) && Number.isSafeInteger((value as FindTextResult).matchIndex)
  && (value as FindTextResult).matchIndex >= 0 && (value as FindTextResult).matchIndex <= (value as FindTextResult).matchCount;

/** Counts `query` in the target's text and selects the next match, as Find Next (or Find Previous) does. */
export function findText(target: TextServicesTarget | null, query: string, options: FindTextOptions = {}): Promise<FindTextResult> {
  return invokeNative(() => {
    const module = native("findBar");
    if (typeof query !== "string" || !query.length) throw new SparkError("E_INVALID_ARGUMENT", "Expected a nonempty query");
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected find options");
    for (const key of Object.keys(options)) if (key !== "caseSensitive" && key !== "wrap" && key !== "backwards") throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported find option: ${key}`);
    return module.findText(tagOf(target), query, flag(options, "caseSensitive", false), flag(options, "wrap", true), flag(options, "backwards", false))
      .then(json => parseNativeResult(json, isFindResult));
  });
}
/** Focuses a multiline TextInput and shows its find bar; rejects `E_UNSUPPORTED_OPTION` for a view without one. */
export function showFindBar(target: TextServicesTarget | null): Promise<void> {
  return invokeNative(() => native("findBar").showFindBar(tagOf(target)));
}
/** Shows the Look Up definition for the target's selection, or the word at its insertion point. */
export function lookUp(target: TextServicesTarget | null): Promise<void> {
  return invokeNative(() => native("lookUp").lookUp(tagOf(target)));
}
