import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useResolveClassNames } from "uniwind";
import { Button } from "@legendapp/spark/ui";
import { getSymbolEffectAvailability, MotionNumber, MotionSymbol, MotionText, type MotionSymbolTarget } from "@legendapp/spark/motion";
import { useI18n } from "../../shell/app-controller";
import { useReadout } from "./motion-demo";
import { useMotionEnvironment } from "./motion-lifecycle";
import { Actions, Page, Readout, Section } from "./MotionScreens";
import { EFFECTS, playEffect, stopEffects, symbolAvailability } from "./text-symbols-demo";
import { useTextSymbolsMessages } from "./text-symbols-messages";

// Test IDs: motion-system-text-and-symbols-<part>. The digits and characters are MotionViews the engine animates on the
// compositor; the symbol effects are AppKit's, on a MotionSymbol.
const id = (part: string) => `motion-system-text-and-symbols-${part}`;
const REDUCE_MOTION = ["reduceMotion"] as const;

export function TextAndSymbols() {
  const t = useTextSymbolsMessages();
  const { locale } = useI18n();
  const large = useResolveClassNames("text-3xl font-semibold text-foreground");
  const body = useResolveClassNames("text-lg text-foreground");
  const [count, setCount] = useState(1234);
  const [word, setWord] = useState(0);
  const [phrase, setPhrase] = useState(0);
  const [slashed, setSlashed] = useState(false);
  const bell = useRef<MotionSymbolTarget>(null);
  const effects = useReadout();
  const environment = useMotionEnvironment(undefined, REDUCE_MOTION);
  return <Page screen="text-and-symbols">
    <View onLayout={environment.refresh}><Readout testID={id("environment")} text={environment.text} /></View>
    <Section title={t.digits} hint={t.digitsHint}>
      <MotionNumber testID={id("number")} value={count} locale={locale} style={large} />
      <Actions>
        <Button testID={id("add-one")} onPress={() => setCount(value => value + 1)}>{t.addOne}</Button>
        <Button testID={id("add-hundred")} onPress={() => setCount(value => value + 100)}>{t.addHundred}</Button>
      </Actions>
      <Readout testID={id("number-value")} text={JSON.stringify({ value: count })} />
    </Section>
    <Section title={t.text} hint={t.textHint}>
      <MotionText testID={id("status")} text={t.words[word]!} style={body} />
      <MotionText testID={id("typed")} text={t.phrases[phrase]!} style={body} transition={{ type: "typewriter", characterMs: 50 }} />
      <Actions>
        <Button testID={id("swap")} onPress={() => setWord(value => 1 - value)}>{t.swap}</Button>
        <Button testID={id("type")} onPress={() => setPhrase(value => 1 - value)}>{t.type}</Button>
      </Actions>
    </Section>
    <Section title={t.symbols} hint={t.symbolsHint}>
      <Readout testID={id("symbol-availability")} text={JSON.stringify(symbolAvailability())} />
      <View className="h-16 justify-center">
        <MotionSymbol ref={bell} testID={id("bell")} name={slashed ? "bell.slash.fill" : "bell.fill"} size={40} color="#f59e0b" replaceTransition="downUp" accessibilityLabel={slashed ? "bell.slash.fill" : "bell.fill"} />
      </View>
      <Actions>
        {/* Only the effects this app and macOS have: availability decides, so flows run what the Mac can play. */}
        {EFFECTS.filter(effect => getSymbolEffectAvailability(effect).available).map(effect =>
          <Button key={effect} testID={id(effect)} onPress={() => effects.run(() => playEffect(bell.current, effect))}>{t.effects[effect]}</Button>)}
        <Button testID={id("replace")} onPress={() => setSlashed(value => !value)}>{t.replace}</Button>
        <Button testID={id("stop")} onPress={() => effects.run(() => stopEffects(bell.current))}>{t.stop}</Button>
      </Actions>
      <Readout testID={id("effect-result")} text={effects.text} />
      <Text className="text-xs text-muted" testID={id("symbol-name")}>{slashed ? "bell.slash.fill" : "bell.fill"}</Text>
    </Section>
  </Page>;
}
