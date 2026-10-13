import { Component, useRef, useState, type PropsWithChildren, type RefObject } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import { Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { MotionEmitter, MotionShader, type MotionShaderEffect, type MotionTarget } from "@legendapp/spark/motion";
import { describeError, useReadout } from "./motion-demo";
import { useMotionEnvironment } from "./motion-lifecycle";
import { Actions, Page, Readout, Section } from "./MotionScreens";
import { bulge, burst, CONFETTI, dissolve, effectAvailability, ripple, start, stop, sweep } from "./shaders-demo";
import { useShadersMessages } from "./shaders-messages";

// Test IDs: motion-system-shaders-<part>. Each card is a MotionShader whose effect is one motion property; the panel is
// a MotionEmitter that JavaScript starts and stops.
const id = (part: string) => `motion-system-shaders-${part}`;
const REDUCE_MOTION = ["reduceMotion"] as const;
const STRIPES = ["#2563eb", "#f97316", "#16a34a", "#e11d48", "#7c3aed"];
const EFFECTS: Record<"ripple" | "dissolve" | "distortion" | "specular", MotionShaderEffect> = {
  ripple: { type: "ripple", origin: { x: 40, y: 28 }, width: 22 },
  dissolve: { type: "dissolve", cellSize: 10, softness: 0.15 },
  distortion: { type: "distortion", radius: 40 },
  specular: { type: "specular", angle: 20, width: 0.22, intensity: 0.75 },
};

/** Shows a card's E_UNAVAILABLE (a dissolve without a Metal device) in its place; anything else reaches the page's boundary. */
class EffectBoundary extends Component<PropsWithChildren<{ id: string }>, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!(error instanceof SparkError && error.code === "E_UNAVAILABLE")) throw error;
    return <Text selectable className="text-xs text-danger" style={{ width: 132 }} testID={`${this.props.id}-error`}>{describeError(error)}</Text>;
  }
}

/** A striped card with a label: something for an effect to bend, dissolve or light. */
function Card({ target, part, effect, label }: { target: RefObject<MotionTarget | null>; part: keyof typeof EFFECTS; effect: MotionShaderEffect; label: string }) {
  return <MotionShader ref={target} testID={id(part)} effect={effect} style={{ width: 132, height: 84, borderRadius: 10, overflow: "hidden" }}>
    <View className="absolute inset-0 flex-row">{STRIPES.map(color => <View key={color} style={{ flex: 1, backgroundColor: color }} />)}</View>
    <View className="flex-1 items-center justify-center"><Text className="text-lg font-semibold" style={{ color: "#ffffff" }}>{label}</Text></View>
  </MotionShader>;
}

export function Shaders() {
  const t = useShadersMessages();
  const cards = { ripple: useRef<MotionTarget>(null), dissolve: useRef<MotionTarget>(null), distortion: useRef<MotionTarget>(null), specular: useRef<MotionTarget>(null) };
  const panel = useRef<MotionTarget>(null);
  const [on, setOn] = useState({ dissolve: false, distortion: false });
  /** The next state of a toggle: the action plays towards it. */
  const next = (key: keyof typeof on) => { setOn(state => ({ ...state, [key]: !state[key] })); return !on[key]; };
  const results = { effect: useReadout(), particles: useReadout() };
  const environment = useMotionEnvironment(cards.ripple, REDUCE_MOTION);
  const LABELS = { ripple: t.ripple, dissolve: t.dissolve, distortion: t.bulge, specular: t.sweep };
  return <Page screen="shaders">
    <Section title={t.effects} hint={t.effectsHint}>
      <Readout testID={id("environment")} text={environment.text} />
      <Readout testID={id("effect-availability")} text={JSON.stringify(effectAvailability())} />
      {/* Laid out once the cards are in their window: the first read reports that window's environment. */}
      <View onLayout={environment.refresh} className="flex-row flex-wrap gap-3">
        {(Object.keys(EFFECTS) as (keyof typeof EFFECTS)[]).map(part =>
          <EffectBoundary key={part} id={id(part)}><Card target={cards[part]} part={part} effect={EFFECTS[part]} label={LABELS[part]} /></EffectBoundary>)}
      </View>
      <Actions>
        <Button testID={id("ripple-play")} onPress={() => results.effect.run(() => ripple(cards.ripple.current))}>{t.ripple}</Button>
        <Button testID={id("dissolve-play")} onPress={() => results.effect.run(() => dissolve(cards.dissolve.current, next("dissolve")))}>{t.dissolve}</Button>
        <Button testID={id("distortion-play")} onPress={() => results.effect.run(() => bulge(cards.distortion.current, next("distortion")))}>{t.bulge}</Button>
        <Button testID={id("specular-play")} onPress={() => results.effect.run(() => sweep(cards.specular.current))}>{t.sweep}</Button>
      </Actions>
      <Readout testID={id("effect-result")} text={results.effect.text} />
    </Section>
    <Section title={t.particles} hint={t.particlesHint}>
      <MotionEmitter ref={panel} testID={id("emitter")} emitter={CONFETTI} style={{ width: 280, height: 120, borderRadius: 10, overflow: "hidden" }}>
        <View className="flex-1 rounded-lg border border-border bg-background" />
      </MotionEmitter>
      <Actions>
        <Button testID={id("particles-start")} onPress={() => results.particles.run(() => start(panel.current))}>{t.start}</Button>
        <Button testID={id("particles-burst")} onPress={() => results.particles.run(() => burst(panel.current))}>{t.burst}</Button>
        <Button testID={id("particles-stop")} onPress={() => results.particles.run(() => stop(panel.current))}>{t.stop}</Button>
      </Actions>
      <Readout testID={id("particles-result")} text={results.particles.text} />
    </Section>
  </Page>;
}
