import { Component, useRef, useState, type PropsWithChildren, type ReactNode, type RefObject } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { getMotionAvailability, MotionView, type MotionTarget } from "@legendapp/spark/motion";
import {
  badgeState, blockJs, describeError, interrupt, playDecay, playKeyframes, playPresets, playSequence, playStagger, playTimeline, presetParameters,
  PRESETS, release, reset, SCROLL_SOURCE, stop, startSlide, TRACK, useLoop, useReadout, useScrollLink, useWay, type Targets,
} from "./motion-demo";
import { useMotionMessages } from "./motion-messages";

// Test IDs: motion-system-<screen>-<part>. Readouts are the JSON the API reports.
type Ref = RefObject<MotionTarget | null>;
const SIZE = 36;

/** Shows a render-time SparkError (E_UNSUPPORTED_PLATFORM on Windows) where the motion views would be. */
class Boundary extends Component<PropsWithChildren<{ id: string }>, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() { return this.state.error ? <Text selectable className="text-xs text-danger" testID={`${this.props.id}-error`}>{describeError(this.state.error)}</Text> : this.props.children; }
}

function Page({ screen, children }: PropsWithChildren<{ screen: string }>) {
  const t = useMotionMessages();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <View className="flex-row items-center gap-2">
      <Text className="text-sm text-muted">{t.availability}</Text>
      <Text selectable className="font-mono text-xs text-muted" testID={`motion-system-${screen}-availability`}>{JSON.stringify(getMotionAvailability())}</Text>
    </View>
    <Boundary id={`motion-system-${screen}`}>{children}</Boundary>
  </ScrollView>;
}

function Section({ title, hint, children }: PropsWithChildren<{ title: string; hint?: string }>) {
  return <View className="gap-2 rounded-lg border border-border bg-surface p-3">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {hint && <Text className="text-xs text-muted">{hint}</Text>}
    {children}
  </View>;
}

/** A box on a track: the MotionView's own layer moves; the themed child fills it. */
function Box({ target, testID, label, tone = "bg-success", children }: PropsWithChildren<{ target: Ref; testID: string; label?: string; tone?: string }>) {
  return <View className="flex-row flex-wrap items-center gap-3">
    {label !== undefined && <Text className="w-20 text-xs text-muted">{label}</Text>}
    <View className="h-10 justify-center rounded-md bg-background" style={{ width: TRACK + SIZE + 8, paddingStart: 4 }}>
      <MotionView ref={target} testID={testID} style={{ width: SIZE, height: SIZE - 8 }}>
        <View className={`flex-1 rounded-md ${tone}`} />
      </MotionView>
    </View>
    {children}
  </View>;
}

function Readout({ testID, text }: { testID: string; text: string }) {
  return text ? <Text selectable className="font-mono text-xs text-muted" testID={testID}>{text}</Text> : null;
}

function Actions({ children }: { children: ReactNode }) { return <View className="flex-row flex-wrap gap-2">{children}</View>; }

function useTargets(count: number) {
  const refs = useRef<Ref[]>([]);
  if (refs.current.length !== count) refs.current = Array.from({ length: count }, () => ({ current: null }));
  return { refs: refs.current, targets: (): Targets => refs.current.map(ref => ref.current) };
}

export function Springs() {
  const t = useMotionMessages();
  const way = useWay();
  const presets = useTargets(PRESETS.length);
  const [forward, setForward] = useState(true);
  const played = useReadout(), interruption = useReadout();
  const slider = useRef<MotionTarget>(null);
  return <Page screen="springs">
    <Section title={t.presets}>
      {PRESETS.map((preset, index) => <Box key={preset} target={presets.refs[index]!} testID={`motion-system-springs-${preset}`} label={t.presetNames[preset]}>
        <Text selectable className="font-mono text-xs text-muted" testID={`motion-system-springs-${preset}-parameters`}>{JSON.stringify(presetParameters(preset))}</Text>
      </Box>)}
      <Actions><Button testID="motion-system-springs-play" onPress={() => { played.run(() => playPresets(presets.targets(), forward, way)); setForward(!forward); }}>{t.play}</Button></Actions>
      <Readout testID="motion-system-springs-play-result" text={played.text} />
    </Section>
    <Section title={t.interruption} hint={t.interruptionHint}>
      <Box target={slider} testID="motion-system-springs-slider" tone="bg-danger" />
      <Actions>
        <Button testID="motion-system-springs-start" onPress={() => interruption.run(() => startSlide(slider.current, way))}>{t.start}</Button>
        <Button testID="motion-system-springs-interrupt" onPress={() => interruption.run(() => interrupt(slider.current))}>{t.interrupt}</Button>
        <Button testID="motion-system-springs-release" onPress={() => interruption.run(() => release(slider.current, way))}>{t.release}</Button>
        <Button testID="motion-system-springs-stop" onPress={() => interruption.run(() => stop(slider.current))}>{t.stop}</Button>
        <Button testID="motion-system-springs-reset" onPress={() => interruption.run(() => reset(slider.current))}>{t.reset}</Button>
      </Actions>
      <Readout testID="motion-system-springs-interruption-result" text={interruption.text} />
    </Section>
  </Page>;
}

export function Timelines() {
  const t = useMotionMessages();
  const way = useWay();
  const path = useRef<MotionTarget>(null), chain = useRef<MotionTarget>(null), fling = useRef<MotionTarget>(null);
  const staggered = useTargets(5), sequenced = useTargets(2);
  const [forward, setForward] = useState(true);
  const results = { keyframes: useReadout(), sequence: useReadout(), stagger: useReadout(), timeline: useReadout(), decay: useReadout() };
  const row = (id: keyof typeof results, title: string, body: ReactNode, action: () => Promise<unknown>, extra?: ReactNode) => <Section key={id} title={title}>
    {body}
    <Actions><Button testID={`motion-system-timelines-${id}-run`} onPress={() => results[id].run(action)}>{t.run}</Button>{extra}</Actions>
    <Readout testID={`motion-system-timelines-${id}-result`} text={results[id].text} />
  </Section>;
  return <Page screen="timelines">
    {row("keyframes", t.keyframes, <Box target={path} testID="motion-system-timelines-keyframes" />, () => playKeyframes(path.current, way))}
    {row("sequence", t.sequence, <Box target={chain} testID="motion-system-timelines-sequence" />, () => playSequence(chain.current, way))}
    {row("stagger", t.stagger, <View className="h-14 flex-row items-end gap-3">
      {staggered.refs.map((ref, index) => <MotionView key={index} ref={ref} testID={`motion-system-timelines-stagger-${index}`} style={{ width: SIZE - 8, height: SIZE - 8 }}>
        <View className="flex-1 rounded-full bg-success" />
      </MotionView>)}
    </View>, () => playStagger(staggered.targets()))}
    {row("timeline", t.timeline, <>
      <Box target={sequenced.refs[0]!} testID="motion-system-timelines-timeline-first" />
      <Box target={sequenced.refs[1]!} testID="motion-system-timelines-timeline-second" tone="bg-danger" />
    </>, () => { setForward(!forward); return playTimeline(sequenced.refs[0]!.current, sequenced.refs[1]!.current, forward, way); })}
    {row("decay", t.decay, <Box target={fling} testID="motion-system-timelines-decay" />, () => playDecay(fling.current, 1800, way),
      <Button testID="motion-system-timelines-decay-back" onPress={() => results.decay.run(() => playDecay(fling.current, -1800, way))}>{t.flingBack}</Button>)}
  </Page>;
}

export function ScrollAndFrames() {
  const t = useMotionMessages();
  const badge = useRef<MotionTarget>(null), runner = useRef<MotionTarget>(null);
  const scroll = useScrollLink(), frames = useReadout(), badgeRead = useReadout();
  const loop = useLoop(runner, useWay());
  return <Page screen="scroll-and-frames">
    <Section title={t.scrollLink} hint={t.scrollHint}>
      <View className="flex-row items-start gap-6">
        <ScrollView nativeID={SCROLL_SOURCE} testID="motion-system-scroll-and-frames-list" className="h-40 w-56 rounded-md border border-border bg-background">
          {Array.from({ length: 20 }, (_, index) => <Text key={index} className="border-b border-border px-3 py-2 text-sm text-foreground">{t.row(index + 1)}</Text>)}
        </ScrollView>
        <MotionView ref={badge} testID="motion-system-scroll-and-frames-badge" style={{ width: 64, height: 64 }}>
          <View className="flex-1 rounded-xl bg-success" />
        </MotionView>
      </View>
      <Actions>
        <Button testID="motion-system-scroll-and-frames-link" onPress={() => scroll.link(badge.current)}>{t.link}</Button>
        <Button testID="motion-system-scroll-and-frames-unlink" onPress={scroll.unlink}>{t.unlink}</Button>
        <Button testID="motion-system-scroll-and-frames-read" onPress={() => badgeRead.run(() => badgeState(badge.current))}>{t.readBadge}</Button>
      </Actions>
      <Readout testID="motion-system-scroll-and-frames-link-result" text={scroll.text} />
      <Readout testID="motion-system-scroll-and-frames-badge-state" text={badgeRead.text} />
    </Section>
    <Section title={t.frames} hint={t.framesHint}>
      <Box target={runner} testID="motion-system-scroll-and-frames-runner" />
      <Readout testID="motion-system-scroll-and-frames-loop" text={loop} />
      <Actions><Button testID="motion-system-scroll-and-frames-block" onPress={() => frames.run(() => blockJs(runner.current))}>{t.blockJs}</Button></Actions>
      <Readout testID="motion-system-scroll-and-frames-report" text={frames.text} />
    </Section>
  </Page>;
}
