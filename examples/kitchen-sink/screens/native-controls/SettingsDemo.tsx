import { Button, TextInput } from "@legendapp/spark/ui";
import {
  SettingsImageChoiceRow, SettingsPage, SettingsRow, SettingsSection, SettingsSegmentedRow,
  SettingsSelectRow, SettingsSwitchRow, SettingsWindow, createSettingsWindowOptions,
} from "@legendapp/spark/ui/settings";
import { openWindow } from "@legendapp/spark/windows";
import { useState } from "react";
import { Platform } from "react-native";
import { Panel, Status, errorText } from "../../Panel";

export const SETTINGS_DEMO_WINDOW = "settings-demo";

const layouts = [
  { label: "Canvas", value: "canvas", image: require("./settings-assets/canvas.png") },
  { label: "Outline", value: "outline", image: require("./settings-assets/outline.png") },
];
const intervals = [
  { label: "Every minute", value: "minute" },
  { label: "Every five minutes", value: "five" },
  { label: "Manually", value: "manual" },
];
const densities = [
  { label: "Compact", value: "compact" },
  { label: "Comfortable", value: "comfortable" },
  { label: "Spacious", value: "spacious" },
  { label: "Extra spacious", value: "extra-spacious" },
];

export function SettingsDemo() {
  const [error, setError] = useState("");
  return (
    <Panel title="Settings window">
      {Platform.OS === "macos" ? (
        <Button testID="settings-demo-open" onPress={() => {
          setError("");
          void openWindow({
            ...createSettingsWindowOptions(),
            id: SETTINGS_DEMO_WINDOW,
            component: "main",
            props: { windowId: SETTINGS_DEMO_WINDOW },
          })
            .catch(cause => setError(errorText(cause)));
        }}>Open settings</Button>
      ) : <Status testID="settings-demo-unavailable">Settings windows require macOS.</Status>}
      {error ? <Status testID="settings-demo-error">{error}</Status> : null}
    </Panel>
  );
}

export function SettingsDemoWindow() {
  const [layout, setLayout] = useState("canvas");
  const [lineNumbers, setLineNumbers] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [interval, setInterval] = useState("minute");
  const [density, setDensity] = useState("comfortable");
  const [name, setName] = useState("Untitled");
  const [reopen, setReopen] = useState(true);
  return (
    <SettingsWindow windowId={SETTINGS_DEMO_WINDOW} defaultPageId="editor">
      <SettingsPage id="general" title="General" icon="gearshape">
        <SettingsSection title="Startup">
          <SettingsSwitchRow label="Reopen documents" description="Restore your documents when the app launches." value={reopen} onValueChange={setReopen} />
          <SettingsRow label="New document name">
            <TextInput value={name} onChangeText={setName} accessibilityLabel="New document name" testID="settings-demo-name" style={{ width: 160, height: 26 }} />
          </SettingsRow>
        </SettingsSection>
      </SettingsPage>
      <SettingsPage id="editor" title="Editor" icon="square.and.pencil">
        <SettingsSection>
          <SettingsImageChoiceRow label="Workspace layout" info="Choose how to arrange the editor and document outline." options={layouts} value={layout} onValueChange={setLayout} />
          <SettingsSwitchRow label="Show line numbers" value={lineNumbers} onValueChange={setLineNumbers} />
          <SettingsSwitchRow label="Wrap long lines" value={wrap} onValueChange={setWrap} />
          <SettingsSwitchRow label="Highlight the current line" value={highlight} onValueChange={setHighlight} />
        </SettingsSection>
        <SettingsSection title="Reading">
          <SettingsSegmentedRow label="Line spacing" options={densities} value={density} onValueChange={setDensity} />
          <SettingsSwitchRow label="Show invisible characters" value={false} onValueChange={() => {}} disabled />
        </SettingsSection>
        <SettingsSection title="Saving">
          <SettingsSelectRow label="Save changes automatically" options={intervals} value={interval} onValueChange={setInterval} />
        </SettingsSection>
      </SettingsPage>
      <SettingsPage id="shortcuts" title="Shortcuts" icon="keyboard">
        <SettingsSection title="Editing">
          <SettingsRow label="Find in document" description="Search the currently open document." />
          <SettingsRow label="Show command palette" description="Find and run editor commands." />
        </SettingsSection>
      </SettingsPage>
    </SettingsWindow>
  );
}
