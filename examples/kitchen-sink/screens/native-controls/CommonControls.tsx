import { Button, Checkbox, RadioGroup, SegmentedControl, TextInput } from "@legendapp/spark/ui";
import { useState } from "react";
import { Text, View } from "react-native";
import { Panel, Status } from "../../Panel";

const reviewKinds = [{ label: "Comment", value: "comment" }, { label: "Approve", value: "approve" }, { label: "Request changes", value: "request" }];
const modes = [{ label: "Changes", value: "changes" }, { label: "History", value: "history" }, { label: "Stashes", value: "stashes" }];

export function CommonControls() {
  const [presses, setPresses] = useState(0);
  const [amend, setAmend] = useState(false);
  const [signOff, setSignOff] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState("changes");
  const [reviewKind, setReviewKind] = useState("comment");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  return <Panel title="Buttons, checkboxes, radios and segments">
    <Status testID="native-controls-common-status">Presses: {presses} · Amend: {String(amend)} · Sign off: {String(signOff)} · Expanded: {String(expanded)} · Mode: {mode} · Review: {reviewKind}</Status>
    <View className="flex-row flex-wrap items-center gap-3">
      <Button testID="native-controls-common-intrinsic-short" onPress={() => setPresses(count => count + 1)}>OK</Button>
      <Button testID="native-controls-common-intrinsic-long" onPress={() => setPresses(count => count + 1)}>Generate Commit Message</Button>
      <Button testID="native-controls-common-borderless" variant="borderless" onPress={() => setPresses(count => count + 1)}>Borderless</Button>
    </View>
    <View className="gap-2">
      <Checkbox testID="native-controls-common-amend" value={amend} onValueChange={setAmend}>Amend last commit</Checkbox>
      <Checkbox testID="native-controls-common-sign-off" value={signOff} onValueChange={setSignOff}>Sign off</Checkbox>
      <Checkbox testID="native-controls-common-disabled" value disabled onValueChange={() => {}}>Disabled (checked)</Checkbox>
    </View>
    <View className="flex-row items-center gap-2">
      <Button testID="native-controls-common-disclosure" variant="disclosure" expanded={expanded} onPress={() => setExpanded(value => !value)}>Details</Button>
      <Text className="text-sm text-foreground">{expanded ? "Hide details" : "Show details"}</Text>
    </View>
    {expanded ? <Text testID="native-controls-common-details" className="text-sm text-muted">Disclosed content follows the controlled expanded prop.</Text> : null}
    <RadioGroup testID="native-controls-common-radio" accessibilityLabel="Review" orientation="horizontal" options={reviewKinds} value={reviewKind} onValueChange={setReviewKind} />
    <RadioGroup testID="native-controls-common-radio-vertical" accessibilityLabel="Mode (small, vertical)" size="small" options={modes} value={mode} onValueChange={setMode} />
    <SegmentedControl testID="native-controls-common-segmented-small" accessibilityLabel="Mode (small, fit)" size="small" options={modes} value={mode} onValueChange={setMode} />
    <Status testID="native-controls-common-text-status">Summary: {summary || "(empty)"} · Body lines: {body ? body.split("\n").length : 0}</Status>
    <View className="flex-row flex-wrap items-start gap-3">
      <TextInput testID="native-controls-common-summary" accessibilityLabel="Summary" placeholder="Commit summary" value={summary} onChangeText={setSummary} />
      <TextInput testID="native-controls-common-body" accessibilityLabel="Description" placeholder="Description (Return adds a line)" multiline value={body} onChangeText={setBody} style={{ width: 320, height: 80 }} />
    </View>
    <SegmentedControl testID="native-controls-common-segmented-fill" accessibilityLabel="Mode (fill)" distribution="fill" style={{ width: 420 }} options={modes} value={mode} onValueChange={setMode} />
  </Panel>;
}
