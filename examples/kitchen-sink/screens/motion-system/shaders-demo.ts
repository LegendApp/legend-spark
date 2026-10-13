import { animate, getParticleAvailability, getShaderEffectAvailability, setMotionValues, spring, startParticles, stopParticles, timing, type MotionTarget, type ParticleEmitter, type ShaderEffect } from "@legendapp/spark/motion";
import { settledValues } from "./effects-demo";

// Demo operations for Motion system > Shaders and particles, through the public @legendapp/spark/motion boundary. Each
// returns the JSON-ready result its readout shows: the animation's outcome and the value it settled at.

const EFFECTS: readonly ShaderEffect[] = ["ripple", "dissolve", "distortion", "specular"];
/** Whether this Mac shows each effect (the dissolve needs a Metal device), and particles. */
export const effectAvailability = () => ({ ...Object.fromEntries(EFFECTS.map(effect => [effect, getShaderEffectAvailability(effect).available])), particles: getParticleAvailability().available });

/** A ripple from the card's origin: back to 0 at once, then the ring travels out. */
export async function ripple(target: MotionTarget | null) {
  await setMotionValues(target, { rippleProgress: 0 });
  return settledValues(target, animate(target, { rippleProgress: timing(1, { durationMs: 700, easing: "easeOut" }) }).finished, ["rippleProgress"]);
}
/** Dissolves the card away, or back in. */
export const dissolve = (target: MotionTarget | null, gone: boolean) =>
  settledValues(target, animate(target, { dissolveProgress: timing(gone ? 1 : 0, { durationMs: 900, easing: "linear" }) }).finished, ["dissolveProgress"]);
/** Springs a bulge in, or back out. */
export const bulge = (target: MotionTarget | null, bulged: boolean) =>
  settledValues(target, animate(target, { distortion: spring(bulged ? 0.6 : 0, { preset: "bouncy" }) }).finished, ["distortion"]);
/** Sweeps a band of light across the card: back to 0 at once, then across. */
export async function sweep(target: MotionTarget | null) {
  await setMotionValues(target, { specularProgress: 0 });
  return settledValues(target, animate(target, { specularProgress: timing(1, { durationMs: 1200, easing: "easeInOut" }) }).finished, ["specularProgress"]);
}

/** Confetti from the panel's top edge: stars and sparks that fall, spin and fade. */
export const CONFETTI: ParticleEmitter = {
  shape: "line", position: { x: 140, y: 0 }, size: { width: 280, height: 0 }, seed: 7,
  cells: [
    { image: "star", color: "#f59e0b", birthRate: 24, lifetimeMs: 2400, velocity: 90, velocityRange: 40, emissionAngle: 90, emissionRange: 50, spin: 180, spinRange: 120, scale: 0.6, scaleRange: 0.2, alphaSpeed: -0.35, acceleration: { x: 0, y: 60 } },
    { image: "spark", color: "#2563eb", birthRate: 18, lifetimeMs: 2000, velocity: 70, velocityRange: 30, emissionAngle: 90, emissionRange: 60, spin: -90, scale: 0.5, alphaSpeed: -0.4, acceleration: { x: 0, y: 60 } },
  ],
};
export const start = (target: MotionTarget | null) => startParticles(target);
export const burst = (target: MotionTarget | null) => startParticles(target, { durationMs: 600 });
export async function stop(target: MotionTarget | null) { await stopParticles(target); return "stopped"; }
