import type { Ref } from "react";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { ColorValue, ViewProps } from "react-native";
import { motionModule } from "./motion";
import { getNativeMotionSymbol } from "./motion-view-host";
import { requireSymbolEffect, type MotionSymbolTarget, type SymbolReplaceTransition } from "./symbols";

/** Props of `MotionSymbol`: the SF Symbol `name`, its point `size` and `color`, and how a name change animates. */
export interface MotionSymbolProps extends ViewProps {
  /** An SF Symbol name; one this macOS does not have throws E_NOT_FOUND. */
  name: string;
  /** Point size of the symbol (default 24); the view is that size unless `style` sizes it. */
  size?: number;
  color?: ColorValue;
  /** How a change of `name` animates (default: at once). A 200 ms cross-fade under Reduce Motion. */
  replaceTransition?: SymbolReplaceTransition;
  ref?: Ref<MotionSymbolTarget>;
}

const TRANSITIONS: readonly SymbolReplaceTransition[] = ["replace", "downUp", "upUp", "offUp"];

/** An SF Symbol that plays symbol effects (playSymbolEffect) and animates name changes. Throws a SparkError where symbol effects are unavailable. */
export function MotionSymbol({ name, size = 24, color, replaceTransition, style, ref, ...props }: MotionSymbolProps) {
  requireSymbolEffect("replace");
  if (typeof name !== "string" || !name) throw new SparkError("E_INVALID_ARGUMENT", "name must be a non-empty SF Symbol name");
  if (!motionModule().hasSymbol(name)) throw new SparkError("E_NOT_FOUND", `This macOS has no SF Symbol named ${name}`);
  if (!(Number.isFinite(size) && size > 0)) throw new SparkError("E_INVALID_ARGUMENT", "size must be a positive finite number");
  if (replaceTransition !== undefined && !TRANSITIONS.includes(replaceTransition)) throw new SparkError("E_INVALID_ARGUMENT", "replaceTransition is replace, downUp, upUp or offUp");
  const NativeSymbol = getNativeMotionSymbol();
  return <NativeSymbol {...props} ref={ref} name={name} size={size} color={color} replaceTransition={replaceTransition ?? ""} style={[{ width: size, height: size }, style]} />;
}
