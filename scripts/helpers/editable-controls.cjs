// Published only as part of the local demo's explicit source allowlist.
const React = require('react');
const { View, Text, TextInput, Pressable, ScrollView } = require('react-native');
const Editing = require('@legendapp/spark/editable');
const styles = {
  container: { padding: 24, backgroundColor: '#e2e8f0' },
  text: { color: '#202020', fontSize: 16 },
  input: { padding: 12, marginVertical: 12, color: '#202020', backgroundColor: 'white', borderRadius: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { padding: 10, backgroundColor: '#cbd5e1', borderRadius: 6 },
  review: { maxHeight: 180, marginTop: 12 },
};
module.exports = function EditingControls() {
  const [prompt, setPrompt] = React.useState('Make the greeting blue');
  const [state, setState] = React.useState();
  const [message, setMessage] = React.useState('');
  const [review, setReview] = React.useState('');
  React.useEffect(() => {
    let alive = true;
    const subscription = Editing.onEditingState(next => { if (alive) setState(next); });
    Editing.getEditingState().then(next => { if (alive) setState(next); }, error => { if (alive) setMessage(error.message); });
    return () => { alive = false; subscription.remove(); };
  }, []);
  const action = (label, handler, enabled = true) => React.createElement(Pressable, {
    key: label, accessibilityRole: 'button', disabled: !enabled,
    style: styles.button, onPress: () => { setMessage(''); Promise.resolve().then(handler).catch(error => setMessage(error.message)); },
  }, React.createElement(Text, { style: styles.text }, label));
  const busy = !!state?.busy;
  return React.createElement(View, { style: styles.container },
    React.createElement(Text, { style: styles.text }, 'App-owned editing controls. CLI/remote requests share relevant source with the selected provider.'),
    React.createElement(TextInput, { accessibilityLabel: 'Customization prompt', value: prompt, onChangeText: setPrompt, style: styles.input, editable: !busy }),
    React.createElement(View, { style: styles.row },
      action('Provider settings', () => Editing.showEditor(), !busy),
      action('Generate edit', () => Editing.generateEdit(prompt, { allowSourceSharing: true }), !busy),
      action('Review changes', async () => setReview((await Editing.getEditReview()).text), !busy),
      action('Preview edit', () => Editing.previewEdit(), !busy && !!state?.ready),
      action('Apply edit', () => Editing.applyEdit(), !busy && !!state?.ready),
      action('Original app', () => Editing.restoreOriginal(), !busy),
      action('Cancel edit', () => Editing.cancelEdit(), busy)),
    React.createElement(Text, { style: styles.text }, message || state?.message || 'Loading editor state…'),
    review ? React.createElement(ScrollView, { style: styles.review, accessibilityLabel: 'Complete edit review' },
      React.createElement(Text, { style: styles.text, selectable: true }, review)) : null);
};
