import { getSymbolEffectAvailability, playSymbolEffect, stopSymbolEffects, type MotionSymbolTarget, type SymbolEffect } from "@legendapp/spark/motion";

// Demo operations for Motion system > Text and symbols, through the public @legendapp/spark/motion boundary.

export const EFFECTS = ["bounce", "pulse", "wiggle", "rotate", "breathe", "drawOff", "drawOn"] as const satisfies readonly SymbolEffect[];
const DIRECTIONS = { bounce: "up", wiggle: "forward", rotate: "clockwise" } as const;

/** Which effects play on this Mac: `true`, or the reason they do not. */
export const symbolAvailability = () => Object.fromEntries([...EFFECTS, "replace" as const].map(effect => {
  const availability = getSymbolEffectAvailability(effect);
  return [effect, availability.available || availability.reason];
}));

/** Plays one effect once (the directional ones in a direction) and reports what played: the effect or its Reduce Motion alternate. */
export async function playEffect(target: MotionSymbolTarget | null, effect: (typeof EFFECTS)[number]) {
  const direction = DIRECTIONS[effect as keyof typeof DIRECTIONS];
  const { played } = await playSymbolEffect(target, effect, direction ? { direction } : {});
  return { played };
}

export const stopEffects = async (target: MotionSymbolTarget | null) => { await stopSymbolEffects(target); return { stopped: true }; };
