import { Component, useState, type PropsWithChildren, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  Button, Checkbox, ComboBox, DisclosureTriangle, getButtonAvailability, getControlAvailability, LevelIndicator, PathControl,
  Progress, RadioGroup, Slider, Stepper, Switch, TokenField,
  type ButtonVariant, type CheckboxValue, type ControlSize,
} from "@legendapp/spark/ui";
import { SparkError } from "@legendapp/spark/contracts";
import { useControlMessages, type ControlRow } from "./control-messages";

// Every sample uses the public @legendapp/spark/ui boundary. Readouts are the JSON the
// API reports, so flows can assert them in any locale. Test IDs: native-controls-<screen>-<row>-<size>.
const SIZES: readonly ControlSize[] = ["mini", "small", "regular", "large"];
const frame = { width: "100%" } as const;
type Shared = { testID: string; size: ControlSize; disabled: boolean; accessibilityLabel: string; style: typeof frame; onError: (error: SparkError) => void };
type Render<T> = (value: T, set: (value: T) => void, shared: Shared) => ReactNode;
type Row = { row: ControlRow; availability: unknown; render: (shared: Omit<Shared, "onError">) => ReactNode };

const describe = (error: unknown) => error instanceof SparkError ? `SparkError:${error.code}` : `Unexpected error: ${String(error)}`;

/** Renders a value-owning sample with its JSON readout and any reported error. */
function Sample<T>({ initial, shared, render }: { initial: T; shared: Omit<Shared, "onError">; render: Render<T> }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();
  return <View className="min-w-36 flex-1 gap-1">
    <Boundary id={shared.testID}>{render(value, setValue, { ...shared, onError: reported => setError(describe(reported)) })}</Boundary>
    <Text selectable className="font-mono text-xs text-muted" testID={`${shared.testID}-value`}>{JSON.stringify(value)}</Text>
    {error && <Text selectable className="text-xs text-danger" testID={`${shared.testID}-error`}>{error}</Text>}
  </View>;
}

/** Shows a render-time SparkError (such as E_UNSUPPORTED_PLATFORM) where the control would be. */
class Boundary extends Component<PropsWithChildren<{ id: string }>, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() { return this.state.error ? <Text selectable className="text-xs text-danger" testID={`${this.props.id}-error`}>{describe(this.state.error)}</Text> : this.props.children; }
}

/** A size grid; `children` renders above it and receives the page's disabled state. */
function Gallery({ screen, rows, children }: { screen: string; rows: readonly Row[]; children?: (disabled: boolean) => ReactNode }) {
  const t = useControlMessages();
  const [disabled, setDisabled] = useState(false);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <Boundary id={`native-controls-${screen}-disabled`}>
      <Checkbox testID={`native-controls-${screen}-disabled`} label={t.disable} value={disabled} onValueChange={value => setDisabled(value === true)} />
    </Boundary>
    {children?.(disabled)}
    <View className="flex-row gap-3 border-b border-border pb-2">
      <Text className="w-36 text-xs font-semibold text-muted">{t.sizeColumn}</Text>
      {SIZES.map(size => <Text key={size} className="min-w-36 flex-1 text-xs font-semibold text-muted">{t.sizes[size]}</Text>)}
    </View>
    {rows.map(({ row, availability, render }) => {
      const id = `native-controls-${screen}-${row}`;
      return <View key={row} className="flex-row items-start gap-3">
        <View className="w-36 gap-1">
          <Text className="text-sm text-foreground">{t.rows[row]}</Text>
          <Text selectable className="font-mono text-xs text-muted" testID={`${id}-availability`}>{JSON.stringify(availability)}</Text>
        </View>
        {SIZES.map(size => <View key={size} className="min-w-36 flex-1">
          {render({ testID: `${id}-${size}`, size, disabled, accessibilityLabel: t.label(t.rows[row], t.sizes[size]), style: frame })}
        </View>)}
      </View>;
    })}
  </ScrollView>;
}

export function Toggles() {
  const t = useControlMessages();
  const options = [{ label: t.radioOptions.first, value: "first" }, { label: t.radioOptions.second, value: "second" }];
  return <Gallery screen="toggles" rows={[
    { row: "checkbox", availability: getControlAvailability("checkbox"), render: shared => <Sample<CheckboxValue> initial={false} shared={shared} render={(value, set, props) => <Checkbox {...props} label={t.checkboxLabel} value={value} onValueChange={set} />} /> },
    { row: "checkbox-mixed", availability: getControlAvailability("checkbox"), render: shared => <Sample<CheckboxValue> initial="mixed" shared={shared} render={(value, set, props) => <Checkbox {...props} label={t.checkboxLabel} value={value} onValueChange={set} />} /> },
    { row: "radio-group", availability: getControlAvailability("radio-group"), render: shared => <Sample initial="first" shared={shared} render={(value, set, props) => <RadioGroup {...props} options={options} value={value} onValueChange={set} />} /> },
    { row: "switch", availability: getControlAvailability("switch"), render: shared => <Sample initial={false} shared={shared} render={(value, set, props) => <Switch {...props} label={t.switchLabel} value={value} onValueChange={set} />} /> },
    { row: "disclosure-triangle", availability: getControlAvailability("disclosure-triangle"), render: shared => <Sample initial={false} shared={shared} render={(value, set, props) => <DisclosureTriangle {...props} label={t.disclosureLabel} value={value} onValueChange={set} />} /> },
  ]} />;
}

const FONTS = ["Helvetica", "Menlo", "Avenir"];
export function Inputs() {
  return <Gallery screen="inputs" rows={[
    { row: "slider", availability: getControlAvailability("slider"), render: shared => <Sample initial={40} shared={shared} render={(value, set, props) => <Slider {...props} value={value} min={0} max={100} onValueChange={set} />} /> },
    { row: "slider-ticks", availability: getControlAvailability("slider"), render: shared => <Sample initial={40} shared={shared} render={(value, set, props) => <Slider {...props} value={value} min={0} max={100} ticks={5} continuous={false} onValueChange={set} />} /> },
    { row: "stepper", availability: getControlAvailability("stepper"), render: shared => <Sample initial={40} shared={shared} render={(value, set, props) => <Stepper {...props} value={value} min={0} max={100} onValueChange={set} />} /> },
    { row: "combo-box", availability: getControlAvailability("combo-box"), render: shared => <Sample initial="Helvetica" shared={shared} render={(value, set, props) => <ComboBox {...props} value={value} options={FONTS} onValueChange={set} />} /> },
    { row: "token-field", availability: getControlAvailability("token-field"), render: shared => <Sample<readonly string[]> initial={["Spark", "Native"]} shared={shared} render={(value, set, props) => <TokenField {...props} value={value} onValueChange={set} />} /> },
    { row: "path-control", availability: getControlAvailability("path-control"), render: shared => <Sample initial="file:///usr/bin" shared={shared} render={(value, set, props) => <PathControl {...props} value={value} onValueChange={set} />} /> },
  ]} />;
}

/** Read-only indicators follow one Stepper so a flow can drive them. */
export function Indicators() {
  const t = useControlMessages();
  const [amount, setAmount] = useState(4);
  const readout = (shared: Omit<Shared, "onError">, value: unknown, control: ReactNode) => <View className="min-w-36 flex-1 gap-1">
    <Boundary id={shared.testID}>{control}</Boundary>
    <Text selectable className="font-mono text-xs text-muted" testID={`${shared.testID}-value`}>{JSON.stringify(value)}</Text>
  </View>;
  return <Gallery screen="indicators" rows={[
    { row: "progress", availability: getControlAvailability("progress"), render: shared => readout(shared, amount / 10, <Progress {...shared} value={amount / 10} />) },
    { row: "progress-indeterminate", availability: getControlAvailability("progress"), render: shared => readout(shared, "indeterminate", <Progress {...shared} mode="indeterminate" />) },
    { row: "progress-spinner", availability: getControlAvailability("progress"), render: shared => readout(shared, "spinner", <Progress {...shared} mode="spinner" />) },
    { row: "level-indicator", availability: getControlAvailability("level-indicator"), render: shared => readout(shared, amount, <LevelIndicator {...shared} value={amount} min={0} max={10} />) },
  ]}>{() => <View className="flex-row items-center gap-3">
    <Text className="text-sm text-foreground">{t.amount}</Text>
    <Boundary id="native-controls-indicators-amount">
      <Stepper testID="native-controls-indicators-amount" accessibilityLabel={t.amount} value={amount} min={0} max={10} onValueChange={setAmount} style={{ width: 24 }} />
    </Boundary>
    <Text selectable className="font-mono text-xs text-muted" testID="native-controls-indicators-amount-value">{JSON.stringify(amount)}</Text>
  </View>}</Gallery>;
}

const BUTTON_ROWS: readonly (Extract<ControlRow, "plain" | "push" | "bevel" | "toolbar" | "help" | "destructive">)[] = ["plain", "push", "bevel", "toolbar", "help", "destructive"];
const variantOf = (row: ControlRow) => row === "plain" ? undefined : row as ButtonVariant;
function Presses({ shared, children }: { shared: Omit<Shared, "onError">; children: (press: () => void) => ReactNode }) {
  const [count, setCount] = useState(0);
  return <View className="min-w-36 flex-1 gap-1">
    <Boundary id={shared.testID}>{children(() => setCount(value => value + 1))}</Boundary>
    <Text selectable className="font-mono text-xs text-muted" testID={`${shared.testID}-value`}>{JSON.stringify(count)}</Text>
  </View>;
}

export function Buttons() {
  const t = useControlMessages();
  return <Gallery screen="buttons" rows={BUTTON_ROWS.map(row => ({
    row,
    availability: getButtonAvailability(variantOf(row) ? { variant: variantOf(row) } : undefined),
    render: shared => <Presses shared={shared}>{press => <Button {...shared} variant={variantOf(row)} onPress={press}>{t.rows[row]}</Button>}</Presses>,
  }))}>{disabled => <KeyboardButtons disabled={disabled} />}</Gallery>;
}

/** One default (Return) and one cancel (Escape) button at a time, next to a plain button that must ignore Return. */
function KeyboardButtons({ disabled }: { disabled: boolean }) {
  const t = useControlMessages();
  const [size, setSize] = useState<ControlSize>("regular");
  const id = "native-controls-buttons-keyboard";
  const shared = (name: string, label: string) => ({ testID: `${id}-${name}`, size, disabled, accessibilityLabel: label, style: frame });
  return <View className="gap-3 border-b border-border pb-4">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{t.keyboard}</Text>
    <Boundary id={`${id}-size`}>
      <RadioGroup testID={`${id}-size`} accessibilityLabel={t.keyboardSize} value={size} onValueChange={value => setSize(value as ControlSize)}
        options={SIZES.map(value => ({ label: t.sizes[value], value }))} style={{ width: 420 }} />
    </Boundary>
    <View className="flex-row gap-3">
      <Presses shared={shared("default", t.defaultButton)}>{press => <Button {...shared("default", t.defaultButton)} variant="default" onPress={press}>{t.defaultButton}</Button>}</Presses>
      <Presses shared={shared("cancel", t.cancelButton)}>{press => <Button {...shared("cancel", t.cancelButton)} variant="cancel" onPress={press}>{t.cancelButton}</Button>}</Presses>
      <Presses shared={shared("plain", t.plainButton)}>{press => <Button testID={`${id}-plain`} disabled={disabled} accessibilityLabel={t.plainButton} style={frame} onPress={press}>{t.plainButton}</Button>}</Presses>
    </View>
  </View>;
}
