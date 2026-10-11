import { useState, type PropsWithChildren, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Checkbox, ColorWell, DatePicker, type ColorWellProps, type DatePickerProps } from "@legendapp/spark/ui";
import { Button } from "../../Controls";
import { Boundary, Sample, type Shared } from "./ControlPrimitives";
import { pickerAvailability, usePanelDemos } from "./picker-demos";
import { usePickerMessages, type PickerRow } from "./picker-messages";

// Every sample uses the public @legendapp/spark/ui boundary, in UTC so readouts and pixels never
// depend on the host's zone. Test IDs: native-controls-pickers-<row>, its -value and -error.
const ID = "native-controls-pickers";
const START = Date.UTC(2026, 2, 14, 9, 30);
const iso = (value: number) => `${value} ${new Date(value).toISOString()}`;
type DateRow = { row: PickerRow; props: Omit<DatePickerProps, "value" | "onValueChange"> };
const DATE_ROWS: readonly DateRow[] = [
  { row: "date", props: { mode: "date" } },
  { row: "time", props: { mode: "time" } },
  { row: "date-time", props: { mode: "date-time" } },
  { row: "text-field", props: { mode: "date-time", variant: "text-field" } },
  { row: "bounded", props: { mode: "date", min: Date.UTC(2026, 2, 1), max: Date.UTC(2026, 2, 31, 23, 59) } },
  // Explicit locales: their digits, field order and calendars do not follow the app language.
  { row: "japanese", props: { mode: "date", locale: "ja-JP", calendar: "japanese" } },
  { row: "umm-al-qura", props: { mode: "date", locale: "ar-SA" } },
  { row: "calendar", props: { mode: "date", variant: "clock-calendar" } },
  { row: "clock", props: { mode: "time", variant: "clock-calendar" } },
];
type WellRow = { row: PickerRow; initial: string; props: Omit<ColorWellProps, "value" | "onValueChange"> };
const WELL_ROWS: readonly WellRow[] = [
  { row: "well", initial: "#3366cc", props: {} },
  { row: "well-minimal", initial: "#cc3366", props: { variant: "minimal" } },
  { row: "well-expanded", initial: "#33cc66", props: { variant: "expanded" } },
  { row: "well-alpha", initial: "#3366cc80", props: { alpha: true } },
];

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="gap-3">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}
/** One labelled sample in a wrapping grid, so the whole family fits the window. */
function Cell({ label, children }: PropsWithChildren<{ label: string }>) {
  return <View className="w-52 gap-1">
    <Text className="text-sm text-foreground">{label}</Text>
    {children}
  </View>;
}
function Result({ id, children }: { id: string; children: ReactNode }) {
  return <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-${id}`}>{children}</Text>;
}

export function Pickers() {
  const t = usePickerMessages();
  const [disabled, setDisabled] = useState(false);
  const panels = usePanelDemos();
  const shared = (row: PickerRow): Omit<Shared, "onError"> => ({ testID: `${ID}-${row}`, size: "regular", disabled, accessibilityLabel: t.rows[row] });
  const font = panels.font;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 p-6">
    <View className="flex-row flex-wrap items-center gap-4">
      <Boundary id={`${ID}-disabled`}>
        <Checkbox testID={`${ID}-disabled`} label={t.disable} value={disabled} onValueChange={value => setDisabled(value === true)} />
      </Boundary>
      <Text className="text-xs text-muted">{t.zoneNote}</Text>
    </View>
    <Section title={t.sections.colors}>
      <View className="flex-row flex-wrap gap-x-6 gap-y-4">
        {WELL_ROWS.map(({ row, initial, props }) => <Cell key={row} label={t.rows[row]}>
          <Sample initial={initial} shared={shared(row)} render={(value, set, sample) => <ColorWell {...sample} {...props} value={value} onValueChange={set} />} />
        </Cell>)}
      </View>
    </Section>
    <Section title={t.sections.dates}>
      <View className="flex-row flex-wrap gap-x-6 gap-y-4">
        {DATE_ROWS.map(({ row, props }) => <Cell key={row} label={t.rows[row]}>
          <Sample initial={START} shared={shared(row)} format={iso} render={(value, set, sample) => <DatePicker {...sample} {...props} timeZone="UTC" value={value} onValueChange={set} />} />
        </Cell>)}
      </View>
    </Section>
    <Section title={t.sections.panels}>
      <View className="flex-row flex-wrap items-center gap-3">
        <Button testID={`${ID}-color-panel`} onPress={() => void panels.openColorPanel()}>{t.showColorPanel}</Button>
        <Button testID={`${ID}-color-panel-close`} onPress={() => void panels.closeColorPanel()}>{t.closePanel}</Button>
        <View className="h-6 w-10 rounded border border-border" style={{ backgroundColor: panels.color }} />
        <Result id="color-panel-value">{panels.color}</Result>
        <Result id="color-panel-state">{panels.colorState ?? t.noResult}</Result>
      </View>
      <View className="flex-row flex-wrap items-center gap-3">
        <Button testID={`${ID}-sampler`} onPress={() => void panels.sampleColor()}>{t.sampleColor}</Button>
        <Result id="sampler-result">{panels.sample ?? t.noResult}</Result>
      </View>
      <View className="flex-row flex-wrap items-center gap-3">
        <Button testID={`${ID}-font-panel`} onPress={() => void panels.openFontPanel()}>{t.showFontPanel}</Button>
        <Button testID={`${ID}-font-panel-close`} onPress={() => void panels.closeFontPanel()}>{t.closePanel}</Button>
        <Result id="font-panel-state">{panels.fontState ?? t.noResult}</Result>
      </View>
      <Result id="font-panel-value">{JSON.stringify(font)}</Result>
      <Text testID={`${ID}-font-sample`} className="text-foreground" style={{ fontFamily: font.family, fontSize: font.size, fontWeight: String(font.weight ?? 400) as "400", fontStyle: font.italic ? "italic" : "normal" }}>{t.fontSample}</Text>
    </Section>
    <View className="gap-1">
      {Object.entries(pickerAvailability()).map(([name, value]) => <Result key={name} id={`availability-${name}`}>{`${name}: ${JSON.stringify(value)}`}</Result>)}
    </View>
  </ScrollView>;
}
