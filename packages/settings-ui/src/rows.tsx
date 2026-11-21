import { SegmentedControl, Select, Switch, type SelectOption } from "@legendapp/spark-ui";
import { selectionIndex } from "@legendapp/spark-ui/src/select";
import { SFSymbol } from "@legendapp/spark-ui/src/sf-symbol";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { Children, Fragment, useState, type ReactNode } from "react";
import * as RN from "react-native";
import type { ColorValue, ImageSourcePropType, NativeSyntheticEvent } from "react-native";

const { Image, Platform, PlatformColor, Pressable, StyleSheet, Text, View } = RN;

// The macOS type entry also declares globals. Keep the additions used here local.
const macOS = RN as typeof RN & {
  DynamicColorMacOS(colors: { light: string; dark: string }): ColorValue;
};
type KeyEvent = NativeSyntheticEvent<{
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}>;
const cardColor = Platform.OS === "macos" ? macOS.DynamicColorMacOS({
  light: "rgba(0,0,0,0.03)",
  dark: "rgba(255,255,255,0.025)",
}) : undefined;

interface RowText {
  label: string;
  description?: string;
  info?: string;
}
export interface SettingsSectionProps {
  title?: string;
  children: ReactNode;
}
export interface SettingsRowProps extends RowText {
  children?: ReactNode;
}
export interface SettingsSwitchRowProps extends RowText {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}
export interface SettingsSelectRowProps extends RowText {
  disabled?: boolean;
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}
export type SettingsSegmentedRowProps = SettingsSelectRowProps;
export interface SettingsImageChoiceOption extends SelectOption {
  image: ImageSourcePropType;
}
export interface SettingsImageChoiceRowProps extends SettingsSelectRowProps {
  options: readonly SettingsImageChoiceOption[];
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Settings sections require macOS");
  return (
    <View style={styles.section}>
      {title ? <Text accessibilityRole="header" style={[styles.heading, { color: PlatformColor("labelColor") }]}>{title}</Text> : null}
      <View style={styles.card}>
        {Children.toArray(children).map((child, index) => (
          <Fragment key={typeof child === "object" && "key" in child ? child.key : index}>
            {index > 0 ? <View style={[styles.divider, { backgroundColor: PlatformColor("separatorColor") }]} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

function Row({ label, description, info, children, disabled, imageChoice }: SettingsRowProps & { disabled?: boolean; imageChoice?: boolean }) {
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Settings rows require macOS");
  return (
    <View style={[styles.row, imageChoice && styles.imageRow]}>
      <View style={[styles.rowText, imageChoice && styles.imageRowText]}>
        <View style={styles.labelLine}>
          <Text style={[styles.label, { color: PlatformColor(disabled ? "tertiaryLabelColor" : "labelColor") }]}>{label}</Text>
          {info ? <View accessible={false} {...{ tooltip: info }} style={styles.info}>
            <SFSymbol accessible={false} name="info.circle" size={13} color={PlatformColor("secondaryLabelColor")} />
          </View> : null}
        </View>
        {description ? <Text style={[styles.description, { color: PlatformColor(disabled ? "tertiaryLabelColor" : "secondaryLabelColor") }]}>{description}</Text> : null}
      </View>
      {children != null ? <View style={[styles.control, imageChoice && styles.imageControl]}>{children}</View> : null}
    </View>
  );
}

export function SettingsRow(props: SettingsRowProps) {
  return <Row {...props} />;
}

function accessibility({ label, description, info }: RowText) {
  return { accessibilityLabel: label, accessibilityHint: [description, info].filter(Boolean).join(" ") || undefined };
}

export function SettingsSwitchRow({ value, onValueChange, disabled, ...text }: SettingsSwitchRowProps) {
  return <Row {...text} disabled={disabled}>
    <Switch value={value} onValueChange={onValueChange} disabled={disabled} {...accessibility(text)} />
  </Row>;
}

export function SettingsSelectRow({ value, options, onValueChange, disabled, ...text }: SettingsSelectRowProps) {
  return <Row {...text} disabled={disabled}>
    <Select options={options} value={value} onValueChange={onValueChange} disabled={disabled} variant="borderless" style={styles.selection} {...accessibility(text)} />
  </Row>;
}

export function SettingsSegmentedRow({ value, options, onValueChange, disabled, ...text }: SettingsSegmentedRowProps) {
  return <Row {...text} disabled={disabled}>
    <SegmentedControl options={options} value={value} onValueChange={onValueChange} disabled={disabled} style={styles.selection} {...accessibility(text)} />
  </Row>;
}

const choiceKeys = [{ key: "ArrowLeft" }, { key: "ArrowRight" }];

export function SettingsImageChoiceRow({ options, value, onValueChange, disabled = false, ...text }: SettingsImageChoiceRowProps) {
  if (!Array.isArray(options) || options.some(option => option?.image == null) || typeof onValueChange !== "function" || typeof disabled !== "boolean") {
    throw new SparkError("E_INVALID_ARGUMENT", "Image choices require options with images and onValueChange");
  }
  const selectedIndex = selectionIndex(options.map(({ image, ...option }) => option), value);
  const [focused, setFocused] = useState(false);
  const accentColor = PlatformColor("controlAccentColor");
  function choose(next: string) {
    if (!disabled && next !== value) onValueChange(next);
  }
  function onKeyDown({ nativeEvent }: KeyEvent) {
    const { key, altKey, ctrlKey, metaKey, shiftKey } = nativeEvent;
    if (altKey || ctrlKey || metaKey || shiftKey) return;
    const step = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
    if (step) choose(options[(selectedIndex + step + options.length) % options.length].value);
  }
  return (
    <Row {...text} disabled={disabled} imageChoice>
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityState={{ disabled }} {...accessibility(text)}
        focusable={!disabled} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        {...{ enableFocusRing: false, ...(!disabled && { onKeyDown, keyDownEvents: choiceKeys }) }}>
        {options.map(option => {
          const selected = option.value === value;
          const captionColor = PlatformColor(disabled ? "tertiaryLabelColor" : selected ? "labelColor" : "secondaryLabelColor");
          return (
            <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
              accessibilityState={{ checked: selected, disabled }} focusable={false} disabled={disabled} onPress={() => choose(option.value)}
              style={styles.choice}>
              <View style={[styles.ring, selected && { borderColor: accentColor }, selected && focused && !disabled && { outlineColor: accentColor, outlineWidth: 1, outlineOffset: 2 }]}>
                <Image accessible={false} source={option.image} resizeMode="cover"
                  style={[styles.image, !selected && { borderColor: PlatformColor("separatorColor"), borderWidth: StyleSheet.hairlineWidth }]} />
              </View>
              <Text style={[styles.caption, { color: captionColor, fontWeight: selected ? "600" : "400" }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  heading: { fontSize: 13, lineHeight: 16, fontWeight: "600", marginHorizontal: 10 },
  card: { backgroundColor: cardColor, borderRadius: 10, overflow: "hidden" },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 10 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 42, padding: 10, gap: 12 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  labelLine: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  label: { fontSize: 13, lineHeight: 16, flexShrink: 1 },
  description: { fontSize: 11, lineHeight: 14 },
  info: { marginTop: 1.5 },
  control: { flexShrink: 1, alignItems: "flex-end" },
  selection: { height: 22, width: 190 },
  imageControl: { maxWidth: "70%" },
  imageRow: { alignItems: "flex-start", paddingVertical: 8 },
  imageRowText: { paddingTop: 5 },
  choices: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 20 },
  choice: { width: 76, alignItems: "center", gap: 6 },
  ring: { borderWidth: 3, borderColor: "transparent", borderRadius: 10, padding: 1 },
  image: { width: 68, height: 42, borderRadius: 6 },
  caption: { fontSize: 11, lineHeight: 14, textAlign: "center" },
});
