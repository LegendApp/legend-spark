import { Component, type PropsWithChildren, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { SparkError } from "@legendapp/spark/contracts";
import { DragDropView, type DragDropViewProps } from "@legendapp/spark/drag-drop";
import { DOCUMENT_ICON, MISSING_IMAGE, PROMISED_FILE, dragAvailability, useDragDemo } from "./drag-demo";
import { useDragMessages } from "./drag-messages";

// Test IDs (prefix drag-drop-features-): availability-<feature>; sources promised, image-view, image-file, image-missing,
// ops-source, ops-fixed; targets ops-target, spring-target; readouts written, end-<source>, ops-dropped, springs,
// highlights (each spring-loading highlight in order), spring-dropped, last-error; on a platform without a feature,
// probe-<feature> shows the typed error.
const ID = "drag-drop-features";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-80 gap-3">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}
function Hint({ children }: PropsWithChildren) { return <Text className="text-xs text-muted">{children}</Text>; }
function Readout({ id, value }: { id: string; value: string }) {
  return <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-${id}`}>{value}</Text>;
}
function Row({ label, id, value }: { label: string; id: string; value: string }) {
  return <View className="flex-row justify-between gap-2">
    <Text className="text-xs text-foreground">{label}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${id}`}>{value}</Text>
  </View>;
}
/** A drag source or drop target tile. */
function Tile({ id, label, ...props }: DragDropViewProps & { id: string; label: string }) {
  return <DragDropView testID={`${ID}-${id}`} accessibilityLabel={label} {...props}>
    <View className="rounded-md border border-border bg-surface p-3">
      <Text className="text-xs text-foreground">{label}</Text>
    </View>
  </DragDropView>;
}
/** Renders a drag view using a feature this platform lacks, and shows the typed error it throws. */
class Probe extends Component<{ id: string; children: ReactNode }, { error: unknown }> {
  state = { error: undefined as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    return <Readout id={`probe-${this.props.id}`} value={`${this.props.id}: ${error instanceof SparkError ? `SparkError:${error.code}` : String(error)}`} />;
  }
}

/** Promised files, custom drag images, operations by modifier key and spring loading through @legendapp/spark/drag-drop. */
export function DragFeatures() {
  const t = useDragMessages();
  const demo = useDragDemo();
  const availability = dragAvailability();
  const end = (id: string) => <Row label={t.dragEnd} id={`end-${id}`} value={demo.ends[id] ?? t.none} />;
  const unavailable = (feature: keyof typeof availability, probe: DragDropViewProps) => <View className="gap-1">
    <Hint>{t.unavailable}</Hint>
    <Probe id={feature}><DragDropView {...probe} /></Probe>
  </View>;
  const text = { text: "Spark drag" };
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-row flex-wrap gap-8 p-6">
    <Section title={t.sections.availability}>
      <View className="gap-1">
        {Object.entries(availability).map(([name, value]) => <Readout key={name} id={`availability-${name}`} value={`${name}: ${JSON.stringify(value)}`} />)}
      </View>
      <Row label={t.lastError} id="last-error" value={demo.lastError ?? t.none} />
    </Section>
    <Section title={t.sections.promised}>
      <Hint>{t.promisedHint}</Hint>
      {availability["promised-files"].available
        ? <Tile id="promised" label={t.promisedSource} source={{ promisedFiles: [{ name: PROMISED_FILE }] }} onPromisedFileWrite={demo.writePromised} {...demo.source("promised")} />
        : unavailable("promised-files", { source: { promisedFiles: [{ name: PROMISED_FILE }] }, onPromisedFileWrite: demo.writePromised })}
      <Row label={t.written} id="written" value={demo.written.length ? `${demo.written.length} · ${demo.written.at(-1)}` : t.none} />
      {end("promised")}
    </Section>
    <Section title={t.sections.images}>
      <Hint>{t.imagesHint}</Hint>
      {availability["drag-image"].available ? <>
        <Tile id="image-view" label={t.imageView} source={text} dragImage="view" {...demo.source("image-view")} />
        <Tile id="image-file" label={t.imageFile} source={text} dragImage={{ path: DOCUMENT_ICON, width: 64, height: 64 }} {...demo.source("image-file")} />
        <Tile id="image-missing" label={t.imageMissing} source={text} dragImage={{ path: MISSING_IMAGE, width: 64, height: 64 }} {...demo.source("image-missing")} />
      </> : unavailable("drag-image", { source: text, dragImage: "view" })}
      {end("image-view")}
    </Section>
    <Section title={t.sections.operations}>
      <Hint>{t.operationsHint}</Hint>
      {availability["operation-masks"].available ? <>
        <Tile id="ops-source" label={t.opsSource} source={text} sourceOperations={{ withinApp: ["copy", "move", "link"], outsideApp: ["copy"] }} {...demo.source("ops-source")} />
        <Tile id="ops-fixed" label={t.opsFixed} source={text} sourceOperations={["copy", "move", "link"]} ignoreModifierKeys {...demo.source("ops-fixed")} />
      </> : unavailable("operation-masks", { source: text, ignoreModifierKeys: true })}
      <Tile id="ops-target" label={t.opsTarget} acceptedTypes={["text"]} acceptedOperations={["move", "copy", "link"]} onDrop={demo.onOpsDrop} onError={demo.onTargetError} />
      <Row label={t.dropped} id="ops-dropped" value={demo.dropped ?? t.none} />
      {end("ops-source")}
    </Section>
    <Section title={t.sections.spring}>
      <Hint>{t.springHint}</Hint>
      {availability["spring-loading"].available
        ? <Tile id="spring-target" label={t.springTarget} acceptedTypes={["text"]} acceptedOperations={["copy", "move"]} springLoading onSpringLoad={demo.onSpringLoad}
          onSpringLoadHighlight={demo.onSpringHighlight} onDrop={demo.onSpringDrop} onError={demo.onTargetError} />
        : unavailable("spring-loading", { springLoading: true })}
      <Row label={t.springs} id="springs" value={String(demo.springs)} />
      <Row label={t.highlight} id="highlights" value={demo.highlights.length ? demo.highlights.join(" → ") : t.none} />
      <Row label={t.dropped} id="spring-dropped" value={demo.springDropped ?? t.none} />
    </Section>
  </ScrollView>;
}
