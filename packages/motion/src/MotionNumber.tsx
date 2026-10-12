import { useEffect, useRef, type RefObject } from "react";
import { StyleSheet, Text, View, type TextStyle, type ViewProps } from "react-native";
import { animate, motionModule, type MotionTarget } from "./motion";
import { MotionView } from "./MotionView";
import { invalid, spring, timing, transitionSpec, type MotionTransition, type SpringOptions, type TimingOptions } from "./specs";

export interface MotionNumberProps extends Pick<ViewProps, "testID" | "nativeID"> {
  /** Also names each digit's MotionView `<testID>-digit-<n>`, `n` counting from 1 at the units digit, for motion telemetry. */
  testID?: string;
  value: number;
  /** BCP 47 locale for the digits and separators (default: the runtime's). */
  locale?: string;
  /** Intl.NumberFormat options. */
  format?: Intl.NumberFormatOptions;
  /** The style of every character: color, font size, weight and family. Digits are tabular. */
  style?: TextStyle;
  /** How a changed digit rolls to its new value (default: the `snappy` spring). */
  transition?: MotionTransition;
}

/** Bidirectional marks that Intl puts around numbers in right-to-left locales; the number itself always runs left to right. */
const MARKS = /[؜‎‏‪-‮⁦-⁩]/g;
const ROW = 1.25;

/** The ten digits of a locale's numbering system, zero first. */
function digitsOf(locale: string | undefined, numberingSystem: string | undefined) {
  const formatter = new Intl.NumberFormat(locale, { useGrouping: false, ...(numberingSystem && { numberingSystem }) });
  return Array.from({ length: 10 }, (_, digit) => formatter.format(digit).replace(MARKS, ""));
}

/** Rolls the column to `digit`: the engine animates its translation on the compositor (a jump that fades in under Reduce Motion). */
function useRoll(column: RefObject<MotionTarget | null>, digit: number, height: number, transition: MotionTransition | undefined) {
  const shown = useRef(digit);
  useEffect(() => {
    if (shown.current === digit) return;
    shown.current = digit;
    const { type, ...options } = transition ?? { preset: "snappy" as const };
    const to = -digit * height;
    // An interrupted roll resolves finished false (the next value has its own roll); an engine failure stays unhandled, never hidden.
    void animate(column.current, { translateY: type === "timing" ? timing(to, options as TimingOptions) : spring(to, options as SpringOptions) }).finished;
  }, [column, digit, height, transition]);
}

function Digit({ digit, digits, height, style, transition, testID }: { digit: number; digits: readonly string[]; height: number; style: TextStyle; transition?: MotionTransition; testID?: string }) {
  const column = useRef<MotionTarget>(null);
  useRoll(column, digit, height, transition);
  return <View style={{ height, overflow: "hidden" }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
    <MotionView ref={column} testID={testID} initial={{ translateY: -digit * height }}>
      {digits.map(character => <Text key={character} style={[style, { height, lineHeight: height }]}>{character}</Text>)}
    </MotionView>
  </View>;
}

/**
 * A formatted number whose changed digits roll to their new values, each digit column a MotionView. Digits keep their
 * place from the right, so 999 → 1000 rolls the last three and adds the leading one. It reads as the whole number.
 */
export function MotionNumber({ value, locale, format, style, transition, testID, nativeID }: MotionNumberProps) {
  motionModule();
  if (!Number.isFinite(value)) invalid("value must be a finite number");
  if (transition !== undefined) transitionSpec(transition);
  const formatter = new Intl.NumberFormat(locale, format);
  const text = formatter.format(value).replace(MARKS, "");
  const digits = digitsOf(locale, formatter.resolvedOptions().numberingSystem);
  const flat = StyleSheet.flatten(style) ?? {};
  const height = flat.lineHeight ?? Math.round((flat.fontSize ?? 17) * ROW);
  const glyph: TextStyle = { ...flat, fontVariant: ["tabular-nums"] };
  const characters = Array.from(text);
  return <View testID={testID} nativeID={nativeID} accessible accessibilityRole="text" accessibilityLabel={text} style={{ flexDirection: "row", direction: "ltr", alignSelf: "flex-start" }}>
    {characters.map((character, index) => {
      // Keyed from the right: the units digit is always the same column.
      const key = characters.length - index, digit = digits.indexOf(character);
      return digit < 0
        ? <Text key={key} style={[glyph, { height, lineHeight: height }]} importantForAccessibility="no">{character}</Text>
        : <Digit key={key} digit={digit} digits={digits} height={height} style={glyph} transition={transition} testID={testID && `${testID}-digit-${key}`} />;
    })}
  </View>;
}
