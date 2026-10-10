// RN macOS 0.81.7-0.88.0-rc.4 legacy views embedded in Fabric can have no React tag.
const fs = require("node:fs");
const path = require("node:path");
const replacements = {
  "React/Views/RCTViewKeyboardEvent.m": [
    `  // Ignore "dead keys" (key press that waits for another key to make a character)
  if (!event.charactersIgnoringModifiers.length) {`,
    `  // Untagged native subviews cannot emit React events. Ignore dead keys too.
  if (reactTag == nil || !event.charactersIgnoringModifiers.length) {`,
  ],
  "React/Views/RCTView.m": [
    `  if (!alreadyEmitted) {
    [_eventDispatcher sendEvent:keyboardEvent];`,
    `  // Do not consume JS delivery when a native subview has no React target/dispatcher.
  if (keyboardEvent != nil && _eventDispatcher != nil && !alreadyEmitted) {
    [_eventDispatcher sendEvent:keyboardEvent];`,
  ],
};
function patchKeyboardSource(file, source) {
  const pair = replacements[file];
  if (!pair) throw new Error(`Unknown keyboard patch target: ${file}`);
  const [before, after] = pair;
  if (source.includes(after) && !source.includes(before)) return source;
  if (source.split(before).length !== 2 || source.includes(after))
    throw new Error(`React Native macOS keyboard source changed (${file}); review the compatibility patch before building.`);
  return source.replace(before, after);
}
function installKeyboardEventsPatch(root) {
  const manifest = require.resolve("react-native-macos/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "0.88.0-rc.4") throw new Error(`spark's keyboard patch requires react-native-macos@0.88.0-rc.4; found ${version}.`);
  // Validate all targets before changing either file.
  const changes = Object.keys(replacements).map(relative => {
    const file = path.join(path.dirname(manifest), relative);
    const before = fs.readFileSync(file, "utf8");
    return {file, before, after: patchKeyboardSource(relative, before)};
  });
  for (const {file, before, after} of changes) if (before !== after) {
    const temporary = `${file}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, after);
    fs.renameSync(temporary, file); // Preserve package-manager cache hardlinks.
  }
}
module.exports = {patchKeyboardSource, installKeyboardEventsPatch};
