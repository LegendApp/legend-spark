import { useState } from "react";
import { StyleSheet, Text, View, type TextStyle, type ViewProps } from "react-native";
import { motionModule } from "./motion";
import { MotionPresence } from "./MotionPresence";
import { MotionView } from "./MotionView";
import { invalid, timing } from "./specs";
import { sharedUnits, textUnits } from "./text-units";

/**
 * `crossfade`: each changed character fades from the old one in its place. `typewriter`: new characters fade in one
 * after another, each over `characterMs`.
 */
export type MotionTextTransition = { type: "crossfade"; durationMs?: number } | { type: "typewriter"; characterMs?: number };

/** Props of `MotionText`: the text, the characters' style, and how a change animates. */
export interface MotionTextProps extends Pick<ViewProps, "testID" | "nativeID"> {
  text: string;
  /** Also names each character's MotionView `<testID>-char-<index>`, for motion telemetry. */
  testID?: string;
  /** The style of every character: color, font size, weight and family. */
  style?: TextStyle;
  /** How a change of `text` animates (default: `crossfade` over 200 ms). The typewriter also types the first text. */
  transition?: MotionTextTransition;
}

const BREAK = { width: "100%", height: 0 } as const;
/** The sizer keeps a character's place without drawing it (opacity 0, so accessibility audits skip it too). */
const HIDDEN = { opacity: 0 } as const;

/** The value of the previous render that had a different value, or undefined before the first change. */
function usePrevious<T>(value: T): T | undefined {
  const [state, setState] = useState<{ value: T; previous?: T }>({ value });
  if (state.value !== value) setState({ value, previous: state.value });
  return state.value === value ? state.previous : state.value;
}

function duration(value: number | undefined, fallback: number, name: string) {
  if (value === undefined) return fallback;
  return Number.isFinite(value) && value >= 0 ? value : invalid(`${name} must be a non-negative finite number`);
}

/** One character's place: it keeps the new character's width while the old one fades out over it. */
function Crossfade({ unit, appear, style, durationMs, testID }: { unit: string; appear: boolean; style?: TextStyle; durationMs: number; testID?: string }) {
  const previous = usePrevious(unit);
  const fadeIn = appear || previous !== undefined ? { initial: { opacity: 0 }, enter: { opacity: timing(1, { durationMs }) } } : {};
  return <View>
    <Text style={[style, HIDDEN]}>{unit}</Text>
    {previous !== undefined && <MotionView key={`was:${previous}`} style={StyleSheet.absoluteFill} enter={{ opacity: timing(0, { durationMs }) }}>
      <Text style={style}>{previous}</Text>
    </MotionView>}
    <MotionView key={`is:${unit}`} testID={testID} style={StyleSheet.absoluteFill} {...fadeIn} exit={{ opacity: timing(0, { durationMs }) }}>
      <Text style={style}>{unit}</Text>
    </MotionView>
  </View>;
}

/**
 * Text whose changes animate a character at a time on the compositor, each character a MotionView: a per-character
 * crossfade or a typewriter. It reads as the whole text. Characters are laid out in a wrapping row in the layout
 * direction (bidirectional text is not reordered), so it suits labels and short lines. A crossfading character's old
 * glyph fades where the new one stands, so the crossfade suits characters that keep their widths (tabular digits,
 * monospaced labels).
 */
export function MotionText({ text, style, transition = { type: "crossfade" }, testID, nativeID }: MotionTextProps) {
  motionModule();
  if (typeof text !== "string") invalid("text must be a string");
  if (!transition || (transition.type !== "crossfade" && transition.type !== "typewriter")) invalid("transition is { type: crossfade } or { type: typewriter }");
  const typewriter = transition.type === "typewriter";
  const characterMs = typewriter ? duration(transition.characterMs, 40, "characterMs") : 0;
  const durationMs = typewriter ? 0 : duration(transition.durationMs, 200, "durationMs");
  const units = textUnits(text);
  const previous = usePrevious(text);
  const row = { flexDirection: "row", flexWrap: "wrap" } as const;
  const label = { testID, nativeID, accessible: true, accessibilityRole: "text", accessibilityLabel: text } as const;
  if (typewriter) {
    // Characters it already showed stay; the rest appear one after another.
    const shared = sharedUnits(previous === undefined ? [] : textUnits(previous), units);
    return <View {...label} style={row}>
      {units.map((unit, index) => unit === "\n" ? <View key={`${index}:\n`} style={BREAK} /> :
        <MotionView key={`${index}:${unit}`} testID={testID && `${testID}-char-${index}`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
          initial={{ opacity: 0 }} enter={{ opacity: timing(1, { durationMs: characterMs, delayMs: Math.max(0, index - shared) * characterMs }) }}>
          <Text style={style}>{unit}</Text>
        </MotionView>)}
    </View>;
  }
  // Characters past the end of a shorter text fade out where they were, then their places close.
  return <View {...label} style={row}>
    <MotionPresence>
      {units.map((unit, index) => unit === "\n" ? <View key={index} style={BREAK} /> :
        <View key={index} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Crossfade unit={unit} appear={previous !== undefined} style={style} durationMs={durationMs} testID={testID && `${testID}-char-${index}`} />
        </View>)}
    </MotionPresence>
  </View>;
}
