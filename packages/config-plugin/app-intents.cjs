// App Intents (docs/app-intents.md). The system only runs intents compiled into the app: Xcode's App Intents metadata
// processor extracts them from Swift types in the app target. macos.appIntents declares them; this generates their
// Swift into the app target, and lists them in Info.plist for @legendapp/spark/app-intents.
const fs = require("node:fs");
const path = require("node:path");

const PACKAGE = "@legendapp/spark-app-intents";
const FILE = "SparkAppIntents.swift";
const TYPES = { string: "String", number: "Double", integer: "Int", boolean: "Bool" };
// Members of the generated intent structs; a parameter cannot take their names.
const RESERVED = ["perform", "title", "description", "openAppWhenRun", "parameterSummary", "authenticationPolicy", "isDiscoverable", "self", "init"];
const APPLICATION_NAME = "${applicationName}";

function fail(message) { throw new Error(`macos.appIntents: ${message}`); }
function keys(value, label, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`unknown ${label} field ${key}`);
}
const text = value => typeof value === "string" && value.trim().length > 0;

/** Validates macos.appIntents and returns it. */
function validateAppIntents(value) {
  if (!Array.isArray(value)) fail("must be a list of intents");
  const ids = new Set();
  let shortcuts = 0;
  for (const intent of value) {
    keys(intent, "intent", ["id", "title", "description", "parameters", "returnsText", "openApp", "shortcut"]);
    if (typeof intent.id !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(intent.id) || ids.has(intent.id)) fail("each intent needs a unique id of letters and digits, starting with a letter");
    ids.add(intent.id);
    if (!text(intent.title)) fail(`${intent.id} needs a title`);
    if (intent.description !== undefined && !text(intent.description)) fail(`${intent.id} description must be text`);
    for (const key of ["returnsText", "openApp"]) if (intent[key] !== undefined && typeof intent[key] !== "boolean") fail(`${intent.id} ${key} must be a boolean`);
    if (intent.parameters !== undefined && !Array.isArray(intent.parameters)) fail(`${intent.id} parameters must be a list`);
    const names = new Set();
    for (const parameter of intent.parameters ?? []) {
      keys(parameter, `${intent.id} parameter`, ["name", "title", "type", "optional"]);
      if (typeof parameter.name !== "string" || !/^[a-z][A-Za-z0-9]{0,63}$/.test(parameter.name) || RESERVED.includes(parameter.name) || names.has(parameter.name))
        fail(`${intent.id} parameters need unique names of letters and digits starting with a lowercase letter, other than ${RESERVED.join(", ")}`);
      names.add(parameter.name);
      if (!text(parameter.title)) fail(`${intent.id} parameter ${parameter.name} needs a title`);
      if (!Object.hasOwn(TYPES, parameter.type)) fail(`${intent.id} parameter ${parameter.name} type must be one of ${Object.keys(TYPES).join(", ")}`);
      if (parameter.optional !== undefined && typeof parameter.optional !== "boolean") fail(`${intent.id} parameter ${parameter.name} optional must be a boolean`);
    }
    if (intent.shortcut !== undefined) {
      keys(intent.shortcut, `${intent.id} shortcut`, ["phrases", "shortTitle", "systemImage"]);
      const { phrases, shortTitle, systemImage } = intent.shortcut;
      if (!Array.isArray(phrases) || !phrases.length || new Set(phrases).size !== phrases.length || phrases.some(phrase => !text(phrase) || phrase.split(APPLICATION_NAME).length !== 2))
        fail(`${intent.id} shortcut phrases must be unique and each name the app once as ${APPLICATION_NAME}`);
      if (!text(shortTitle) || !text(systemImage)) fail(`${intent.id} shortcut needs a shortTitle and a systemImage (an SF Symbol name)`);
      shortcuts++;
    }
  }
  if (shortcuts > 10) fail("at most 10 intents can have a shortcut");
  return value;
}

/** The Info.plist SparkAppIntents list @legendapp/spark/app-intents reads. */
function appIntentDeclarations(intents) {
  return intents.map(intent => ({
    id: intent.id, title: intent.title, returnsText: intent.returnsText === true,
    parameters: (intent.parameters ?? []).map(({ name, title, type, optional }) => ({ name, title, type, optional: optional === true })),
  }));
}

const escape = value => value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
const literal = value => `"${escape(value)}"`;
const phrase = value => `"${value.split(APPLICATION_NAME).map(escape).join("\\(.applicationName)")}"`;
const structName = id => `SparkIntent_${id}`;
const swiftType = parameter => `${TYPES[parameter.type]}${parameter.optional ? "?" : ""}`;

function intentSwift(intent) {
  const parameters = intent.parameters ?? [];
  const values = parameters.length
    ? `[${parameters.map(({ name, optional }) => `${literal(name)}: ${optional ? `\`${name}\`.map { $0 as Any } ?? NSNull()` : `\`${name}\``}`).join(", ")}]`
    : "[:]";
  const call = `try await sparkPerform(${literal(intent.id)}, ${values})`;
  return [
    `struct ${structName(intent.id)}: AppIntent {`,
    `  static let title: LocalizedStringResource = ${literal(intent.title)}`,
    ...(intent.description ? [`  static let description = IntentDescription(${literal(intent.description)})`] : []),
    ...(intent.openApp ? ["  static let openAppWhenRun = true"] : []),
    ...parameters.map(parameter => `  @Parameter(title: ${literal(parameter.title)}) var \`${parameter.name}\`: ${swiftType(parameter)}`),
    "",
    ...(intent.returnsText ? [
      "  func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {",
      `    guard let text = ${call} else { throw SparkAppIntentError(message: ${literal(`${intent.id} returned no text`)}) }`,
      "    return .result(value: text, dialog: \"\\(text)\")",
    ] : [
      "  func perform() async throws -> some IntentResult {",
      `    _ = ${call}`,
      "    return .result()",
    ]),
    "  }",
    "}",
  ].join("\n");
}

function donationSwift(intent) {
  return [
    `    case ${literal(intent.id)}:`,
    `      let intent = ${structName(intent.id)}()`,
    ...(intent.parameters ?? []).map(({ name, type, optional }) => optional
      ? `      intent.\`${name}\` = parameters[${literal(name)}] as? ${TYPES[type]}`
      : `      intent.\`${name}\` = try sparkValue(parameters, ${literal(name)})`),
    "      _ = try await IntentDonationManager.shared.donate(intent: intent)",
  ].join("\n");
}

/** The Swift the app target compiles: one AppIntent per declared intent, their App Shortcuts, and the donation entry point. */
function appIntentsSwift(intents) {
  const shortcuts = intents.filter(intent => intent.shortcut);
  return [
    "// Generated by Spark from macos.appIntents (docs/app-intents.md). spark build regenerates it; do not edit.",
    "import AppIntents",
    "import Foundation",
    "import RNDesktopAppIntents",
    "",
    "private struct SparkAppIntentError: Error, CustomLocalizedStringResourceConvertible {",
    "  let message: String",
    "  var localizedStringResource: LocalizedStringResource { \"\\(message)\" }",
    "}",
    "",
    "// Runs the intent's JavaScript handler (addAppIntentHandler) through @legendapp/spark/app-intents.",
    "private func sparkPerform(_ identifier: String, _ parameters: [String: Any]) async throws -> String? {",
    "  do { return try await SparkAppIntentsBridge.performIntent(identifier, parameters: parameters) }",
    "  catch { throw SparkAppIntentError(message: error.localizedDescription) }",
    "}",
    "",
    "private func sparkValue<Value>(_ parameters: [String: Any], _ name: String) throws -> Value {",
    "  guard let value = parameters[name] as? Value else { throw SparkAppIntentError(message: \"Missing parameter \\(name)\") }",
    "  return value",
    "}",
    "",
    ...intents.flatMap(intent => [intentSwift(intent), ""]),
    ...(shortcuts.length ? [
      "struct SparkAppShortcuts: AppShortcutsProvider {",
      "  static var appShortcuts: [AppShortcut] {",
      ...shortcuts.map(({ id, shortcut }) => `    AppShortcut(intent: ${structName(id)}(), phrases: [${shortcut.phrases.map(phrase).join(", ")}], shortTitle: ${literal(shortcut.shortTitle)}, systemImageName: ${literal(shortcut.systemImage)})`),
      "  }",
      "}",
      "",
    ] : []),
    "// @legendapp/spark/app-intents finds this class by name to donate intents (donateAppIntent).",
    "@objc(SparkGeneratedAppIntents) final class SparkGeneratedAppIntents: NSObject, SparkAppIntentDonating {",
    "  static func donate(_ identifier: String, parameters: [String: Any]) async throws {",
    "    switch identifier {",
    ...intents.map(donationSwift),
    "    default:",
    "      throw SparkAppIntentError(message: \"macos.appIntents declares no intent \\(identifier)\")",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
}

/** Generates the app target's intents and their Info.plist list when macos.appIntents declares any. */
function withAppIntents(config, { withInfoPlist, withXcodeProject, Xcodeproj: xcodeproj, selection }) {
  const intents = config.macos?.appIntents;
  if (intents === undefined || !validateAppIntents(intents).length) return config;
  config = withInfoPlist(config, mod => { mod.modResults.SparkAppIntents = appIntentDeclarations(intents); return mod; });
  return withXcodeProject(config, mod => {
    const { projectRoot, platformProjectRoot } = mod.modRequest;
    const included = selection(projectRoot);
    // A production build links only the packages the app's JavaScript imports.
    if (included && !included.includes(PACKAGE))
      throw new Error(`macos.appIntents declares intents, but the app never imports @legendapp/spark/app-intents to handle them`);
    const Xcodeproj = xcodeproj();
    const projectName = Xcodeproj.getProjectName(projectRoot, "macos");
    fs.writeFileSync(path.join(platformProjectRoot, projectName, FILE), appIntentsSwift(intents));
    // The file sits in the app target's group, whose path is its folder.
    if (mod.modResults.hasFile(FILE)) return mod;
    // The template's project also has an iOS target; the macOS app target is named after its source folder.
    const targetUuid = Object.entries(mod.modResults.pbxNativeTargetSection())
      .find(([key, target]) => !key.endsWith("_comment") && String(target.name).replace(/"/g, "") === projectName)?.[0];
    if (!targetUuid) throw new Error(`The generated Xcode project has no ${projectName} target to compile App Intents into`);
    mod.modResults = Xcodeproj.addBuildSourceFileToGroup({ filepath: FILE, groupName: projectName, project: mod.modResults, targetUuid });
    return mod;
  });
}

/** Fails a build whose app lacks the metadata of an intent macos.appIntents declares: the system would not know it. */
function checkAppIntentsMetadata(app, intents) {
  if (!intents?.length) return;
  const file = path.join(app, "Contents/Resources/Metadata.appintents/extract.actionsdata");
  const actions = fs.existsSync(file) ? Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).actions ?? {}) : [];
  const missing = intents.map(intent => structName(intent.id)).filter(name => !actions.includes(name));
  if (missing.length) throw new Error(`The build lacks App Intents metadata for ${missing.join(", ")} in Contents/Resources/Metadata.appintents: Xcode did not extract the intents macos.appIntents declares (docs/app-intents.md#build).`);
}

module.exports = { validateAppIntents, appIntentDeclarations, appIntentsSwift, withAppIntents, checkAppIntentsMetadata };
