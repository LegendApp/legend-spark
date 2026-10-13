import { useRef, useState } from "react";
import { View } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { MotionShape, type MotionEnvironment, type MotionTarget } from "@legendapp/spark/motion";
import { useReadout } from "./motion-demo";
import { useMotionEnvironment } from "./motion-lifecycle";
import { Actions, Page, Readout, Section } from "./MotionScreens";
import { CHECK, drawCheck, FILLS, morphTo, presented, PROGRESS, RING, setProgress, SHAPES } from "./shapes-demo";
import { useShapesMessages } from "./shapes-messages";

// Test IDs: motion-system-shapes-<part>. Each shape is a MotionShape: its morph, stroke trim and colors are motion
// properties the engine animates on the compositor. Paths are not mirrored in right-to-left layouts.
const id = (part: string) => `motion-system-shapes-${part}`;
const ENVIRONMENT: readonly (keyof MotionEnvironment)[] = ["reduceMotion"];
const STROKE = { lineCap: "round", lineJoin: "round" } as const;

export function Shapes() {
  const t = useShapesMessages();
  const shape = useRef<MotionTarget>(null), check = useRef<MotionTarget>(null), ring = useRef<MotionTarget>(null);
  const [state, setState] = useState({ shape: 0, drawn: false, progress: 0 });
  const results = { morph: useReadout(), draw: useReadout(), progress: useReadout(), read: useReadout() };
  const environment = useMotionEnvironment(shape, ENVIRONMENT);
  const step = <K extends keyof typeof state>(key: K, next: (value: (typeof state)[K]) => (typeof state)[K]) => {
    const value = next(state[key]);
    setState(current => ({ ...current, [key]: value }));
    return value;
  };
  return <Page screen="shapes">
    <Section title={t.morph} hint={t.morphHint}>
      <Readout testID={id("environment")} text={environment.text} />
      {/* Laid out once the shape is in its window: the first read reports that window's environment. */}
      <View onLayout={environment.refresh} style={{ width: 120, height: 120 }}>
        <MotionShape ref={shape} testID={id("shape")} paths={SHAPES} initial={{ fillColor: FILLS[0] }} style={{ width: 120, height: 120 }} />
      </View>
      <Actions>
        <Button testID={id("next")} onPress={() => results.morph.run(() => morphTo(shape.current, step("shape", index => (index + 1) % SHAPES.length)))}>{t.nextShape}</Button>
      </Actions>
      <Readout testID={id("morph-result")} text={results.morph.text} />
    </Section>
    <Section title={t.stroke} hint={t.strokeHint}>
      <View className="flex-row gap-4">
        <MotionShape ref={check} testID={id("check")} paths={[CHECK]} {...STROKE} initial={{ strokeColor: "#16a34a", strokeWidth: 7, strokeEnd: 0 }} style={{ width: 72, height: 72 }} />
        <View style={{ width: 72, height: 72 }}>
          <MotionShape testID={id("track")} paths={[RING]} initial={{ strokeColor: "#94a3b859", strokeWidth: 8 }} style={{ position: "absolute", width: 72, height: 72 }} />
          <MotionShape ref={ring} testID={id("ring")} paths={[RING]} {...STROKE} initial={{ strokeColor: "#2563eb", strokeWidth: 8, strokeEnd: PROGRESS[0] }} style={{ position: "absolute", width: 72, height: 72 }} />
        </View>
      </View>
      <Actions>
        <Button testID={id("draw")} onPress={() => results.draw.run(() => drawCheck(check.current, step("drawn", drawn => !drawn)))}>{t.draw}</Button>
        <Button testID={id("progress")} onPress={() => results.progress.run(() => setProgress(ring.current, PROGRESS[step("progress", index => (index + 1) % PROGRESS.length)]!))}>{t.progress}</Button>
        <Button testID={id("read")} onPress={() => results.read.run(() => presented(shape.current, check.current))}>{t.read}</Button>
      </Actions>
      <Readout testID={id("draw-result")} text={results.draw.text} />
      <Readout testID={id("progress-result")} text={results.progress.text} />
      <Readout testID={id("read-result")} text={results.read.text} />
    </Section>
  </Page>;
}
