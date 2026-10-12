import { useRef, useState } from "react";
import { View } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { MotionMaterial, type MotionEnvironment, type MotionTarget } from "@legendapp/spark/motion";
import { fadeMaterial, materialAvailability, requireGlass, STEPS, TINT, tintMaterial } from "./materials-demo";
import { useMaterialsMessages } from "./materials-messages";
import { useReadout } from "./motion-demo";
import { useMotionEnvironment } from "./motion-lifecycle";
import { Actions, Page, Readout, Section } from "./MotionScreens";

// Test IDs: motion-system-materials-<part>. The panel is a MotionMaterial: a change of material crossfades on the
// engine, and its intensity and tint opacity are motion properties.
const id = (part: string) => `motion-system-materials-${part}`;
const ENVIRONMENT: readonly (keyof MotionEnvironment)[] = ["reduceMotion", "reduceTransparency"];
const STRIPES = ["#2563eb", "#f97316", "#16a34a", "#e11d48"];
/** A spring crossfade: under Reduce Motion it becomes the 200 ms fade, which a flow tells apart. */
const CROSSFADE = { preset: "smooth" } as const;

export function Materials() {
  const t = useMaterialsMessages();
  const panel = useRef<MotionTarget>(null);
  const [step, setStep] = useState(0);
  const [glass, setGlass] = useState(false);
  const [shown, setShown] = useState({ material: true, tint: false });
  const toggle = (key: keyof typeof shown) => { setShown(state => ({ ...state, [key]: !state[key] })); return !shown[key]; };
  const results = { material: useReadout(), tint: useReadout(), glass: useReadout() };
  const environment = useMotionEnvironment(panel, ENVIRONMENT);
  const available = materialAvailability();
  const material = glass ? "glass" : STEPS[step]!;
  return <Page screen="materials">
    <Section title={t.backdrop} hint={t.backdropHint}>
      <Readout testID={id("environment")} text={environment.text} />
      <Readout testID={id("material-availability")} text={JSON.stringify(available.visualEffects)} />
      <Readout testID={id("glass-availability")} text={JSON.stringify(available.glass)} />
      {/* Laid out once the panel is in its window: the first read reports that window's environment. */}
      <View onLayout={environment.refresh} className="overflow-hidden rounded-lg" style={{ width: 280, height: 120 }}>
        <View className="absolute inset-0 flex-row">{STRIPES.map(color => <View key={color} style={{ flex: 1, backgroundColor: color }} />)}</View>
        <MotionMaterial ref={panel} testID={id("panel")} material={material} blendingMode={glass ? undefined : "withinWindow"} tintColor={TINT} crossfade={CROSSFADE} initial={{ materialTintOpacity: 0 }}
          style={{ position: "absolute", top: 16, bottom: 16, start: 24, end: 24, borderRadius: 12, overflow: "hidden" }} />
      </View>
      <Readout testID={id("material")} text={JSON.stringify({ material })} />
      <Actions>
        <Button testID={id("next")} onPress={() => { setGlass(false); setStep(index => (index + 1) % STEPS.length); }}>{t.next}</Button>
        {/* Always offered, so the screen looks the same on every macOS: without Liquid Glass it reports why. */}
        <Button testID={id("glass")} onPress={() => results.glass.run(async () => { requireGlass(); setGlass(!glass); return { glass: !glass }; })}>{t.glass}</Button>
        <Button testID={id("fade")} onPress={() => results.material.run(() => fadeMaterial(panel.current, toggle("material")))}>{t.fade}</Button>
        <Button testID={id("tint")} onPress={() => results.tint.run(() => tintMaterial(panel.current, toggle("tint")))}>{t.tint}</Button>
      </Actions>
      <Readout testID={id("glass-result")} text={results.glass.text} />
      <Readout testID={id("fade-result")} text={results.material.text} />
      <Readout testID={id("tint-result")} text={results.tint.text} />
    </Section>
  </Page>;
}
