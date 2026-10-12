import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { MotionView, type MotionTarget } from "@legendapp/spark/motion";
import { BLUE, blur, flip, iris, lift, PATH_LENGTH, playColor, presentedColor, REVEAL_HEIGHT, REVEAL_WIDTH, tilt, travel, wipe } from "./effects-demo";
import { useEffectsMessages } from "./effects-messages";
import { useReadout, useWay } from "./motion-demo";
import { useMotionEnvironment } from "./motion-lifecycle";
import { Actions, Page, Readout, Section } from "./MotionScreens";

// Test IDs: motion-system-visual-effects-<part>. Every effect is a MotionView property the engine animates on the
// compositor: the background color in OKLCH, corner radius, shadow, blur, 3D rotation with perspective, and mask insets.
const id = (part: string) => `motion-system-visual-effects-${part}`;
const REDUCE_MOTION = ["reduceMotion"] as const;
type Toggle = "color" | "lift" | "blur" | "flip" | "tilt" | "wipe" | "path";

export function VisualEffects() {
  const t = useEffectsMessages();
  const swatch = useRef<MotionTarget>(null), card = useRef<MotionTarget>(null), turn = useRef<MotionTarget>(null), reveal = useRef<MotionTarget>(null), arrow = useRef<MotionTarget>(null);
  const way = useWay();
  const [on, setOn] = useState<Record<Toggle, boolean>>({ color: false, lift: false, blur: false, flip: false, tilt: false, wipe: true, path: false });
  /** The next state of a toggle: the action plays towards it. */
  const next = (key: Toggle) => { setOn(state => ({ ...state, [key]: !state[key] })); return !on[key]; };
  const results = { color: useReadout(), colorNow: useReadout(), surface: useReadout(), depth: useReadout(), mask: useReadout(), path: useReadout() };
  const environment = useMotionEnvironment(swatch, REDUCE_MOTION);
  return <Page screen="visual-effects">
    <Section title={t.colors} hint={t.colorsHint}>
      <Readout testID={id("environment")} text={environment.text} />
      {/* Laid out once the swatch is in its window: the first read reports that window's environment. */}
      <View onLayout={environment.refresh}>
        <MotionView ref={swatch} testID={id("swatch")} initial={{ backgroundColor: BLUE, borderRadius: 8 }} style={{ width: 160, height: 40 }} />
      </View>
      <Actions>
        <Button testID={id("color")} onPress={() => results.color.run(() => playColor(swatch.current, next("color")))}>{t.toggleColor}</Button>
        <Button testID={id("color-read")} onPress={() => results.colorNow.run(() => presentedColor(swatch.current))}>{t.readColor}</Button>
      </Actions>
      <Readout testID={id("color-result")} text={results.color.text} />
      <Readout testID={id("color-now")} text={results.colorNow.text} />
    </Section>
    <Section title={t.surface} hint={t.surfaceHint}>
      <View className="h-24 justify-center">
        {/* The style sets the background and corners; Lift animates the corners from there and owns them afterwards. */}
        <MotionView ref={card} testID={id("card")} style={{ width: 120, height: 64, backgroundColor: "#0ea5e9", borderRadius: 4 }} />
      </View>
      <Actions>
        <Button testID={id("lift")} onPress={() => results.surface.run(() => lift(card.current, next("lift")))}>{t.lift}</Button>
        <Button testID={id("blur")} onPress={() => results.surface.run(() => blur(card.current, next("blur")))}>{t.blur}</Button>
      </Actions>
      <Readout testID={id("surface-result")} text={results.surface.text} />
    </Section>
    <Section title={t.depth} hint={t.depthHint}>
      <View className="h-24 justify-center">
        <MotionView ref={turn} testID={id("turn")} initial={{ backgroundColor: "#f97316", borderRadius: 8, perspective: 500 }} style={{ width: 120, height: 64 }} />
      </View>
      <Actions>
        <Button testID={id("flip")} onPress={() => results.depth.run(() => flip(turn.current, next("flip")))}>{t.flip}</Button>
        <Button testID={id("tilt")} onPress={() => results.depth.run(() => tilt(turn.current, next("tilt")))}>{t.tilt}</Button>
      </Actions>
      <Readout testID={id("depth-result")} text={results.depth.text} />
    </Section>
    <Section title={t.mask} hint={t.maskHint}>
      <MotionView ref={reveal} testID={id("reveal")} style={{ width: REVEAL_WIDTH, height: REVEAL_HEIGHT }}>
        <View className="flex-1 items-center justify-center rounded-md border border-border bg-background">
          <Text className="text-sm text-foreground">{t.revealed}</Text>
        </View>
      </MotionView>
      <Actions>
        <Button testID={id("wipe")} onPress={() => results.mask.run(() => wipe(reveal.current, next("wipe")))}>{t.wipe}</Button>
        <Button testID={id("iris")} onPress={() => results.mask.run(() => iris(reveal.current))}>{t.iris}</Button>
      </Actions>
      <Readout testID={id("mask-result")} text={results.mask.text} />
    </Section>
    <Section title={t.path} hint={t.pathHint}>
      <View className="h-24 justify-center" style={{ width: PATH_LENGTH + 40, paddingStart: 8 }}>
        <MotionView ref={arrow} testID={id("arrow")} initial={{ rotate: way === 1 ? 0 : 180 }} style={{ width: 24, height: 24 }}>
          <View className="flex-1 items-center justify-center rounded-full bg-accent-primary"><Text className="text-xs text-background">➜</Text></View>
        </MotionView>
      </View>
      <Actions><Button testID={id("travel")} onPress={() => results.path.run(() => travel(arrow.current, next("path"), way))}>{t.travel}</Button></Actions>
      <Readout testID={id("path-result")} text={results.path.text} />
    </Section>
  </Page>;
}
