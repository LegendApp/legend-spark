import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { selectionIndex } from "./select";
import type { DatePickerCalendar, PrimitiveKind, PrimitivePropsByKind } from "./primitives.types";

export const primitiveKinds: readonly PrimitiveKind[] = ["checkbox", "radio-group", "switch", "slider", "stepper", "combo-box", "token-field", "path-control", "progress", "level-indicator", "disclosure-triangle", "date-picker", "color-well"];
export function isPrimitiveKind(value: string): value is PrimitiveKind { return primitiveKinds.includes(value as PrimitiveKind); }
const commonProps = new Set(["size", "disabled", "accessibilityLabel", "style", "testID", "ref", "onError"]);
const kindProps: Record<PrimitiveKind, readonly string[]> = {
  checkbox: ["value", "onValueChange", "label"],
  "radio-group": ["value", "onValueChange", "options"],
  switch: ["value", "onValueChange", "label"],
  slider: ["value", "onValueChange", "min", "max", "step", "ticks", "continuous"],
  stepper: ["value", "onValueChange", "min", "max", "step"],
  "combo-box": ["value", "onValueChange", "options"],
  "token-field": ["value", "onValueChange"],
  "path-control": ["value", "onValueChange"],
  progress: ["value", "mode"],
  "level-indicator": ["value", "min", "max"],
  "disclosure-triangle": ["value", "onValueChange", "label"],
  "date-picker": ["value", "onValueChange", "mode", "variant", "min", "max", "locale", "calendar", "timeZone"],
  "color-well": ["value", "onValueChange", "alpha", "variant"],
};
// Foundation spells two Unicode calendar identifiers differently.
const calendars: Record<DatePickerCalendar, string> = {
  gregory: "gregorian", buddhist: "buddhist", chinese: "chinese", coptic: "coptic", ethioaa: "ethiopic-amete-alem", ethiopic: "ethiopic", hebrew: "hebrew", indian: "indian",
  islamic: "islamic", "islamic-civil": "islamic-civil", "islamic-tbla": "islamic-tbla", "islamic-umalqura": "islamic-umalqura", iso8601: "iso8601", japanese: "japanese", persian: "persian", roc: "roc",
};
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
/** An sRGB hex color: `#rrggbb`, or `#rrggbbaa` when alpha is allowed (`exact`: required). Returns it lowercase. */
export function hexColor(value: unknown, alpha: boolean, exact = false): string {
  if (typeof value !== "string" || !HEX.test(value) || (!alpha && value.length === 9) || (exact && alpha && value.length !== 9)) invalid(alpha ? "Expected a #rrggbb or #rrggbbaa color" : "Expected a #rrggbb color");
  return value.toLowerCase();
}
function invalid(message: string): never { throw new SparkError("E_INVALID_ARGUMENT", message); }
function isFileURL(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "file:" && url.pathname.startsWith("/"); } catch { return false; }
}
/** Validate and serialize only native-owned control configuration. */
export function primitivePayload<K extends PrimitiveKind>(kind: K, props: PrimitivePropsByKind[K]): string {
  if (!isPrimitiveKind(kind)) invalid("Unknown control kind");
  for (const key of Object.keys(props)) if (!commonProps.has(key) && !kindProps[kind].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported ${kind} option: ${key}`);
  if (props.size !== undefined && !["mini", "small", "regular", "large"].includes(props.size)) invalid("Invalid control size");
  if ("onValueChange" in props && typeof props.onValueChange !== "function") invalid("Expected onValueChange");
  if (kind !== "progress" && kind !== "level-indicator" && !("onValueChange" in props)) invalid("Expected onValueChange");
  switch (kind) {
    case "checkbox": {
      const p = props as PrimitivePropsByKind["checkbox"];
      if (typeof p.value !== "boolean" && p.value !== "mixed") invalid("Checkbox requires a boolean or mixed value");
      if (p.label !== undefined && typeof p.label !== "string") invalid("Invalid control label");
      return JSON.stringify({ value: p.value, label: p.label ?? "" });
    }
    case "switch": case "disclosure-triangle": {
      const p = props as PrimitivePropsByKind["switch"];
      if (typeof p.value !== "boolean") invalid("Expected a boolean value");
      if (p.label !== undefined && typeof p.label !== "string") invalid("Invalid control label");
      return JSON.stringify({ value: p.value, label: p.label ?? "" });
    }
    case "radio-group": {
      const p = props as PrimitivePropsByKind["radio-group"];
      selectionIndex(p.options, p.value);
      return JSON.stringify({ value: p.value, options: p.options });
    }
    case "slider": case "stepper": case "level-indicator": {
      const p = props as PrimitivePropsByKind["slider"], { min = 0, max = 100, step = 1, ticks = 0, continuous = true } = p;
      if (![p.value, min, max, step].every(Number.isFinite) || min >= max || step <= 0 || p.value < min || p.value > max) invalid("Expected a finite value within min/max and positive step");
      if (kind === "slider" && (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 1000 || typeof continuous !== "boolean")) invalid("Invalid slider ticks or continuous option");
      return JSON.stringify({ value: p.value, min, max, ...(kind !== "level-indicator" ? { step } : {}), ...(kind === "slider" ? { ticks, continuous } : {}) });
    }
    case "combo-box": {
      const p = props as PrimitivePropsByKind["combo-box"];
      if (typeof p.value !== "string" || !Array.isArray(p.options) || !p.options.every(item => typeof item === "string")) invalid("ComboBox requires text and string options");
      return JSON.stringify({ value: p.value, options: p.options });
    }
    case "token-field": {
      const p = props as PrimitivePropsByKind["token-field"];
      if (!Array.isArray(p.value) || !p.value.every(item => typeof item === "string")) invalid("TokenField requires string tokens");
      return JSON.stringify({ value: p.value });
    }
    case "path-control": {
      if (!isFileURL(props.value)) invalid("PathControl requires a file URL");
      return JSON.stringify({ value: props.value });
    }
    case "progress": {
      const p = props as PrimitivePropsByKind["progress"], mode = p.mode ?? "determinate";
      if (!["determinate", "indeterminate", "spinner"].includes(mode)) invalid("Invalid progress mode");
      if (mode === "determinate" ? (!Number.isFinite(p.value) || p.value! < 0 || p.value! > 1) : p.value !== undefined) invalid("Determinate progress requires a value from zero to one; animated progress has no value");
      return JSON.stringify({ value: p.value ?? 0, mode });
    }
    case "date-picker": {
      const p = props as PrimitivePropsByKind["date-picker"], { mode = "date", variant = "text-field-stepper" } = p;
      const min = p.min ?? null, max = p.max ?? null;
      if (![p.value, min ?? 0, max ?? 0].every(Number.isFinite) || (min !== null && p.value < min) || (max !== null && p.value > max)) invalid("DatePicker requires a finite Unix timestamp in milliseconds within min/max");
      if (!["date", "time", "date-time"].includes(mode) || !["text-field-stepper", "text-field", "clock-calendar"].includes(variant)) invalid("Invalid date picker mode or variant");
      if (p.locale !== undefined && (typeof p.locale !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(p.locale))) invalid("Expected a BCP 47 locale");
      if (p.calendar !== undefined && !Object.hasOwn(calendars, p.calendar)) invalid("Unknown calendar");
      if (p.timeZone !== undefined && (typeof p.timeZone !== "string" || !p.timeZone.length || p.timeZone.includes("\0"))) invalid("Expected an IANA time zone");
      return JSON.stringify({ value: p.value, mode, variant, min, max, locale: p.locale ?? "", calendar: p.calendar ? calendars[p.calendar] : "", timeZone: p.timeZone ?? "" });
    }
    case "color-well": {
      const p = props as PrimitivePropsByKind["color-well"], { alpha = false, variant = "default" } = p;
      if (typeof alpha !== "boolean" || !["default", "minimal", "expanded"].includes(variant)) invalid("Invalid color well alpha or variant");
      return JSON.stringify({ value: hexColor(p.value, alpha), alpha, variant });
    }
    default: return invalid("Unknown control kind");
  }
}
/** Native events carry a raw JSON value, never a configuration object. */
export function primitiveEventValue<K extends PrimitiveKind>(kind: K, props: PrimitivePropsByKind[K], json: unknown): unknown {
  try {
    if (typeof json !== "string" || kind === "progress" || kind === "level-indicator") throw new Error("Unexpected native value");
    const value: unknown = JSON.parse(json);
    primitivePayload(kind, { ...props, value } as PrimitivePropsByKind[K]);
    if (kind === "color-well") hexColor(value, (props as PrimitivePropsByKind["color-well"]).alpha ?? false, true);
    return value;
  } catch (cause) { throw new SparkError("E_INVALID_DATA", "Invalid native control value", { cause }); }
}
