// App Intents (docs/app-intents.md). The system only runs intents compiled into the app: Xcode's App Intents metadata
// processor extracts them from Swift types in the app target. macos.appIntents declares them, with the enums and
// entities their parameters use (macos.appEnums, macos.appEntities); this generates their Swift and the strings
// catalogs that translate their titles into the app target, and lists them in Info.plist for @legendapp/spark/app-intents.
const fs = require("node:fs");
const path = require("node:path");

const PACKAGE = "@legendapp/spark-app-intents";
const FILE = "SparkAppIntents.swift";
// The strings table of every title, and the catalog App Shortcut phrases must be translated in (Apple's name).
const TABLE = "SparkAppIntents";
const SHORTCUTS_TABLE = "AppShortcuts";
const TYPES = { string: "String", number: "Double", integer: "Int", boolean: "Bool" };
// Members of the generated intent structs; a parameter cannot take their names.
const RESERVED = ["perform", "title", "description", "openAppWhenRun", "parameterSummary", "authenticationPolicy", "isDiscoverable", "self", "init"];
// Members of the generated enums; a case cannot take their names.
const RESERVED_CASES = ["self", "init", "rawValue", "allCases", "typeDisplayRepresentation", "caseDisplayRepresentations"];
const APPLICATION_NAME = "applicationName";
const PLACEHOLDER = /\$\{([A-Za-z0-9]+)\}/g;

function fail(message) { throw new Error(`macos.appIntents: ${message}`); }
function keys(value, label, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`unknown ${label} field ${key}`);
}
const text = value => typeof value === "string" && value.trim().length > 0;
const list = (value, label) => { if (value !== undefined && !Array.isArray(value)) fail(`${label} must be a list`); return value ?? []; };

// A title is text, or text for each of the app's localizations ({ en: "Recipe", ar: "وصفة" }). The development
// language's text (localizations[0]) is its key in the strings catalog.
function checkLocalized(value, label, languages) {
  if (text(value)) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be text, or text for each of the app's localizations`);
  if (!languages) fail(`${label} is translated, so the app needs localizations`);
  if (Object.keys(value).length !== languages.length || languages.some(language => !text(value[language])))
    fail(`${label} needs text for each of the app's localizations, and only those: ${languages.join(", ")}`);
}
const variants = value => typeof value === "string" ? [value] : Object.values(value);
const source = (value, languages) => typeof value === "string" ? value : value[languages[0]];
const placeholders = value => [...value.matchAll(PLACEHOLDER)].map(match => match[1]);

// Every translation of a phrase or summary uses the same placeholders, each one `allowed`; a phrase names the app once.
function checkPlaceholders(value, label, allowed, phrase) {
  const expected = placeholders(variants(value)[0]).sort().join();
  for (const variant of variants(value)) {
    const used = placeholders(variant);
    if (phrase && used.filter(name => name === APPLICATION_NAME).length !== 1) fail(`${label} must name the app once as \${${APPLICATION_NAME}}`);
    const unknown = used.find(name => !allowed.includes(name) && !(phrase && name === APPLICATION_NAME));
    if (unknown) fail(`${label} uses \${${unknown}}, which is not ${phrase ? "an enum parameter of the intent" : "a parameter of the intent"}`);
    if (used.sort().join() !== expected) fail(`${label} must use the same placeholders in every language`);
  }
}

function checkValue(parameter, value, enums) {
  if (parameter.type === "string") return typeof value === "string";
  if (parameter.type === "boolean") return typeof value === "boolean";
  if (parameter.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (parameter.type === "integer") return Number.isSafeInteger(value);
  return enums[parameter.type]?.cases.some(item => item.value === value) ?? false;
}

/**
 * Validates macos.appIntents, macos.appEnums and macos.appEntities against each other and the app's localizations, and
 * returns { intents, enums, entities }.
 */
function validateAppIntents(macos = {}, languages) {
  const intents = list(macos.appIntents, "macos.appIntents"), enumList = list(macos.appEnums, "macos.appEnums"), entityList = list(macos.appEntities, "macos.appEntities");
  const types = new Set(), enums = {}, entities = {}, used = new Set();
  for (const [kind, declarations] of [["enum", enumList], ["entity", entityList]]) for (const type of declarations) {
    keys(type, kind, kind === "enum" ? ["id", "title", "cases"] : ["id", "title"]);
    if (typeof type.id !== "string" || !/^[A-Z][A-Za-z0-9]{0,63}$/.test(type.id) || types.has(type.id)) fail(`each enum and entity needs a unique id of letters and digits, starting with an uppercase letter`);
    types.add(type.id);
    checkLocalized(type.title, `${type.id} title`, languages);
    if (kind === "entity") { entities[type.id] = type; continue; }
    if (!Array.isArray(type.cases) || !type.cases.length) fail(`${type.id} needs cases`);
    const values = new Set();
    for (const item of type.cases) {
      keys(item, `${type.id} case`, ["value", "title"]);
      if (typeof item.value !== "string" || !/^[a-z][A-Za-z0-9]{0,63}$/.test(item.value) || RESERVED_CASES.includes(item.value) || values.has(item.value))
        fail(`${type.id} cases need unique values of letters and digits starting with a lowercase letter, other than ${RESERVED_CASES.join(", ")}`);
      values.add(item.value);
      checkLocalized(item.title, `${type.id} case ${item.value} title`, languages);
    }
    enums[type.id] = type;
  }
  const ids = new Set();
  let shortcuts = 0;
  for (const intent of intents) {
    keys(intent, "intent", ["id", "title", "description", "parameters", "parameterSummary", "returnsText", "openApp", "shortcut"]);
    if (typeof intent.id !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(intent.id) || ids.has(intent.id)) fail("each intent needs a unique id of letters and digits, starting with a letter");
    ids.add(intent.id);
    checkLocalized(intent.title, `${intent.id} title`, languages);
    if (intent.description !== undefined) checkLocalized(intent.description, `${intent.id} description`, languages);
    for (const key of ["returnsText", "openApp"]) if (intent[key] !== undefined && typeof intent[key] !== "boolean") fail(`${intent.id} ${key} must be a boolean`);
    const names = new Set();
    for (const parameter of list(intent.parameters, `${intent.id} parameters`)) {
      keys(parameter, `${intent.id} parameter`, ["name", "title", "type", "optional", "default"]);
      if (typeof parameter.name !== "string" || !/^[a-z][A-Za-z0-9]{0,63}$/.test(parameter.name) || RESERVED.includes(parameter.name) || names.has(parameter.name))
        fail(`${intent.id} parameters need unique names of letters and digits starting with a lowercase letter, other than ${RESERVED.join(", ")}`);
      names.add(parameter.name);
      const label = `${intent.id} parameter ${parameter.name}`;
      checkLocalized(parameter.title, `${label} title`, languages);
      if (!Object.hasOwn(TYPES, parameter.type) && !types.has(parameter.type)) fail(`${label} type must be one of ${Object.keys(TYPES).join(", ")}, or an enum or entity id`);
      used.add(parameter.type);
      if (parameter.optional !== undefined && typeof parameter.optional !== "boolean") fail(`${label} optional must be a boolean`);
      if (parameter.default !== undefined && entities[parameter.type]) fail(`${label} cannot have a default: it is an entity`);
      if (parameter.default !== undefined && !checkValue(parameter, parameter.default, enums)) fail(`${label} default must be a value of its type${enums[parameter.type] ? ` (a case value of ${parameter.type})` : ""}`);
    }
    const parameters = intent.parameters ?? [];
    if (intent.parameterSummary !== undefined) {
      checkLocalized(intent.parameterSummary, `${intent.id} parameterSummary`, languages);
      checkPlaceholders(intent.parameterSummary, `${intent.id} parameterSummary`, parameters.map(parameter => parameter.name), false);
    }
    if (intent.shortcut !== undefined) {
      keys(intent.shortcut, `${intent.id} shortcut`, ["phrases", "shortTitle", "systemImage"]);
      const { phrases, shortTitle, systemImage } = intent.shortcut;
      if (!Array.isArray(phrases) || !phrases.length) fail(`${intent.id} shortcut needs phrases`);
      // A phrase can include only enum parameters: the system lists their cases as phrases.
      const enumParameters = parameters.filter(parameter => enums[parameter.type]).map(parameter => parameter.name);
      phrases.forEach((phrase, index) => {
        checkLocalized(phrase, `${intent.id} shortcut phrase ${index + 1}`, languages);
        checkPlaceholders(phrase, `${intent.id} shortcut phrase ${index + 1}`, enumParameters, true);
      });
      if (new Set(phrases.map(phrase => source(phrase, languages))).size !== phrases.length) fail(`${intent.id} shortcut phrases must be unique`);
      checkLocalized(shortTitle, `${intent.id} shortcut shortTitle`, languages);
      if (!text(systemImage)) fail(`${intent.id} shortcut needs a systemImage (an SF Symbol name)`);
      shortcuts++;
    }
  }
  if (shortcuts > 10) fail("at most 10 intents can have a shortcut");
  const unused = [...types].find(type => !used.has(type));
  if (unused) fail(`no intent parameter uses ${unused}`);
  const result = { intents, enums: enumList, entities: entityList };
  appIntentsStrings(result, languages);
  return result;
}

/** The Info.plist SparkAppIntents list @legendapp/spark/app-intents reads; titles in the development language. */
function appIntentDeclarations({ intents, enums = [], entities = [] }, languages) {
  return intents.map(intent => ({
    id: intent.id, title: source(intent.title, languages), returnsText: intent.returnsText === true,
    parameters: (intent.parameters ?? []).map(parameter => {
      const declared = enums.find(type => type.id === parameter.type);
      return {
        name: parameter.name, title: source(parameter.title, languages),
        ...(declared ? { type: "enum", values: declared.cases.map(item => item.value) } : entities.some(type => type.id === parameter.type) ? { type: "entity", entity: parameter.type } : { type: parameter.type }),
        optional: parameter.optional === true, ...(parameter.default !== undefined ? { default: parameter.default } : {}),
      };
    }),
  }));
}

/** The Info.plist SparkAppEntities list: the entities whose queries JavaScript answers. */
function appEntityDeclarations({ entities = [] }, languages) {
  return entities.map(entity => ({ id: entity.id, title: source(entity.title, languages) }));
}

// A strings catalog: each translated text under its development-language key. One key cannot have two translations.
function catalog(entries, languages) {
  const strings = {};
  for (const value of entries) {
    if (typeof value === "string") continue;
    const key = value[languages[0]];
    const localizations = Object.fromEntries(languages.slice(1).map(language => [language, { stringUnit: { state: "translated", value: value[language] } }]));
    if (strings[key] && JSON.stringify(strings[key].localizations) !== JSON.stringify(localizations)) fail(`"${key}" is translated in two different ways; give one of them other text`);
    strings[key] = { extractionState: "manual", localizations };
  }
  return Object.keys(strings).length ? `${JSON.stringify({ sourceLanguage: languages[0], strings, version: "1.0" }, null, 2)}\n` : undefined;
}

/**
 * The strings catalogs the app target compiles: SparkAppIntents.xcstrings (every translated title) and
 * AppShortcuts.xcstrings (translated App Shortcut phrases). Undefined when nothing is translated.
 */
function appIntentsStrings({ intents, enums = [], entities = [] }, languages) {
  const titles = [
    ...intents.flatMap(intent => [intent.title, intent.description, intent.parameterSummary, intent.shortcut?.shortTitle, ...(intent.parameters ?? []).map(parameter => parameter.title)]),
    ...enums.flatMap(type => [type.title, ...type.cases.map(item => item.title)]),
    ...entities.map(type => type.title),
  ].filter(value => value !== undefined);
  return { [`${TABLE}.xcstrings`]: catalog(titles, languages), [`${SHORTCUTS_TABLE}.xcstrings`]: catalog(intents.flatMap(intent => intent.shortcut?.phrases ?? []), languages) };
}

// A Swift string literal's contents: backslashes and quotes escaped, every control character (below 0x20, and 0x7F) as \u{XX}.
const escape = value => value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")
  .replace(/[\u0000-\u001f\u007f]/g, character => `\\u{${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}}`);
const literal = value => `"${escape(value)}"`;
// A title in the SparkAppIntents table, so the system shows its translation.
const resource = (value, languages) => `LocalizedStringResource(${literal(source(value, languages))}, table: ${literal(TABLE)})`;
// A phrase or summary: ${applicationName} and ${parameter} become the interpolations App Intents reads.
const interpolated = value => `"${value.split(/(\$\{[A-Za-z0-9]+\})/).map(part => {
  const name = /^\$\{([A-Za-z0-9]+)\}$/.exec(part)?.[1];
  return !name ? escape(part) : name === APPLICATION_NAME ? "\\(.applicationName)" : `\\(\\.$${name})`;
}).join("")}"`;
const enumName = id => `SparkEnum_${id}`;
const entityName = id => `SparkEntity_${id}`;
const structName = id => `SparkIntent_${id}`;

function swiftType(parameter, kinds) {
  const kind = kinds[parameter.type];
  return `${kind === "enum" ? enumName(parameter.type) : kind === "entity" ? entityName(parameter.type) : TYPES[parameter.type]}${parameter.optional ? "?" : ""}`;
}
function swiftDefault(parameter, kinds) {
  const value = parameter.default;
  if (kinds[parameter.type] === "enum") return `.\`${value}\``;
  return typeof value === "string" ? literal(value) : String(value);
}
// The value JavaScript gets: an enum's case value, an entity's id.
function swiftValue({ name, type }, kinds) {
  return kinds[type] === "enum" ? `${name}.rawValue` : kinds[type] === "entity" ? `${name}.id` : name;
}

function intentSwift(intent, kinds, languages) {
  const parameters = intent.parameters ?? [];
  const values = parameters.length
    ? `[${parameters.map(parameter => {
      const value = swiftValue({ ...parameter, name: "$0" }, kinds);
      return `${literal(parameter.name)}: ${parameter.optional ? `\`${parameter.name}\`.map { ${value} as Any } ?? NSNull()` : swiftValue({ ...parameter, name: `\`${parameter.name}\`` }, kinds)}`;
    }).join(", ")}]`
    : "[:]";
  const call = `try await sparkPerform(${literal(intent.id)}, ${values})`;
  return [
    `struct ${structName(intent.id)}: AppIntent {`,
    `  static let title = ${resource(intent.title, languages)}`,
    ...(intent.description ? [`  static let description = IntentDescription(${resource(intent.description, languages)})`] : []),
    ...(intent.openApp ? ["  static let openAppWhenRun = true"] : []),
    ...parameters.map(parameter => `  @Parameter(title: ${resource(parameter.title, languages)}${parameter.default !== undefined ? `, default: ${swiftDefault(parameter, kinds)}` : ""}) var \`${parameter.name}\`: ${swiftType(parameter, kinds)}`),
    ...(intent.parameterSummary ? [`  static var parameterSummary: some ParameterSummary { Summary(${interpolated(source(intent.parameterSummary, languages))}, table: ${literal(TABLE)}) }`] : []),
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

function enumSwift(type, languages) {
  return [
    `enum ${enumName(type.id)}: String, AppEnum {`,
    ...type.cases.map(item => `  case \`${item.value}\``),
    `  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: ${resource(type.title, languages)})`,
    `  static let caseDisplayRepresentations: [${enumName(type.id)}: DisplayRepresentation] = [`,
    ...type.cases.map(item => `    .\`${item.value}\`: DisplayRepresentation(title: ${resource(item.title, languages)}),`),
    "  ]",
    "}",
  ].join("\n");
}

// An entity is an id, a title and an optional subtitle; JavaScript answers its queries (addAppEntityQueryHandler).
function entitySwift(type, languages) {
  const name = entityName(type.id), query = `SparkQuery_${type.id}`, id = literal(type.id);
  return [
    `struct ${name}: SparkEntity {`,
    `  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: ${resource(type.title, languages)})`,
    `  static let defaultQuery = ${query}()`,
    "  let id: String",
    "  let title: String",
    "  let subtitle: String?",
    "}",
    "",
    `struct ${query}: EntityStringQuery {`,
    `  func entities(for identifiers: [String]) async throws -> [${name}] { try await sparkQuery(${id}, ["kind": "identifiers", "identifiers": identifiers]) }`,
    `  func suggestedEntities() async throws -> [${name}] { try await sparkQuery(${id}, ["kind": "suggested"]) }`,
    `  func entities(matching string: String) async throws -> [${name}] { try await sparkQuery(${id}, ["kind": "search", "text": string]) }`,
    "}",
  ].join("\n");
}

function donationSwift(intent, kinds) {
  const assign = ({ name, type, optional }) => {
    const kind = kinds[type], key = literal(name);
    if (kind === "entity") return optional
      ? `      if let id = parameters[${key}] as? String { intent.\`${name}\` = try await sparkEntity(SparkQuery_${type}(), id) }`
      : `      intent.\`${name}\` = try await sparkEntity(SparkQuery_${type}(), try sparkValue(parameters, ${key}))`;
    const value = kind === "enum" ? `${enumName(type)}(rawValue: $0)` : null;
    if (optional) return `      intent.\`${name}\` = (parameters[${key}] as? ${kind === "enum" ? "String" : TYPES[type]})${value ? `.flatMap { ${value} }` : ""}`;
    return kind === "enum" ? `      intent.\`${name}\` = try sparkCase(parameters, ${key})` : `      intent.\`${name}\` = try sparkValue(parameters, ${key})`;
  };
  return [
    `    case ${literal(intent.id)}:`,
    `      let intent = ${structName(intent.id)}()`,
    ...(intent.parameters ?? []).map(assign),
    "      _ = try await IntentDonationManager.shared.donate(intent: intent)",
  ].join("\n");
}

/**
 * The Swift the app target compiles: one AppEnum per enum, an AppEntity and its query per entity, one AppIntent per
 * intent, their App Shortcuts, and the donation entry point.
 */
function appIntentsSwift({ intents, enums = [], entities = [] }, languages) {
  const kinds = Object.fromEntries([...enums.map(type => [type.id, "enum"]), ...entities.map(type => [type.id, "entity"])]);
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
    ...(enums.length ? [
      "private func sparkCase<Value: RawRepresentable>(_ parameters: [String: Any], _ name: String) throws -> Value where Value.RawValue == String {",
      "  guard let value = Value(rawValue: try sparkValue(parameters, name)) else { throw SparkAppIntentError(message: \"Unknown value of \\(name)\") }",
      "  return value",
      "}",
      "",
      ...enums.flatMap(type => [enumSwift(type, languages), ""]),
    ] : []),
    ...(entities.length ? [
      "protocol SparkEntity: AppEntity where ID == String {",
      "  var title: String { get }",
      "  var subtitle: String? { get }",
      "  init(id: String, title: String, subtitle: String?)",
      "}",
      "extension SparkEntity {",
      "  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: \"\\(title)\", subtitle: subtitle.map { \"\\($0)\" }) }",
      "}",
      "",
      "// Answers an entity query with the JavaScript query handler's entities (addAppEntityQueryHandler).",
      "private func sparkQuery<Entity: SparkEntity>(_ entity: String, _ query: [String: Any]) async throws -> [Entity] {",
      "  let items: [[String: Any]]",
      "  do { items = try await SparkAppIntentsBridge.queryEntities(entity, query: query) }",
      "  catch { throw SparkAppIntentError(message: error.localizedDescription) }",
      "  return try items.map { item in",
      "    guard let id = item[\"id\"] as? String, let title = item[\"title\"] as? String else { throw SparkAppIntentError(message: \"Malformed \\(entity) entity\") }",
      "    return Entity(id: id, title: title, subtitle: item[\"subtitle\"] as? String)",
      "  }",
      "}",
      "",
      "// The entity a donation names by its id, from the query handler.",
      "private func sparkEntity<Query: EntityQuery>(_ query: Query, _ id: String) async throws -> Query.Entity where Query.Entity.ID == String {",
      "  guard let entity = try await query.entities(for: [id]).first(where: { $0.id == id }) else { throw SparkAppIntentError(message: \"No entity \\(id)\") }",
      "  return entity",
      "}",
      "",
      ...entities.flatMap(type => [entitySwift(type, languages), ""]),
    ] : []),
    ...intents.flatMap(intent => [intentSwift(intent, kinds, languages), ""]),
    ...(shortcuts.length ? [
      "struct SparkAppShortcuts: AppShortcutsProvider {",
      "  static var appShortcuts: [AppShortcut] {",
      ...shortcuts.map(({ id, shortcut }) => `    AppShortcut(intent: ${structName(id)}(), phrases: [${shortcut.phrases.map(phrase => interpolated(source(phrase, languages))).join(", ")}], shortTitle: ${resource(shortcut.shortTitle, languages)}, systemImageName: ${literal(shortcut.systemImage)})`),
      "  }",
      "}",
      "",
    ] : []),
    "// @legendapp/spark/app-intents finds this class by name to donate intents (donateAppIntent).",
    "@objc(SparkGeneratedAppIntents) final class SparkGeneratedAppIntents: NSObject, SparkAppIntentDonating {",
    "  static func donate(_ identifier: String, parameters: [String: Any]) async throws {",
    "    switch identifier {",
    ...intents.map(intent => donationSwift(intent, kinds)),
    "    default:",
    "      throw SparkAppIntentError(message: \"macos.appIntents declares no intent \\(identifier)\")",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
}

/** Generates the app target's intents, strings catalogs and their Info.plist lists when macos.appIntents declares any. */
function withAppIntents(config, { withInfoPlist, withXcodeProject, Xcodeproj: xcodeproj, selection }) {
  if (config.macos?.appIntents === undefined && config.macos?.appEnums === undefined && config.macos?.appEntities === undefined) return config;
  const languages = config.extra?.spark?.localizations;
  const declared = validateAppIntents(config.macos, languages);
  if (!declared.intents.length) return config;
  config = withInfoPlist(config, mod => {
    mod.modResults.SparkAppIntents = appIntentDeclarations(declared, languages);
    if (declared.entities.length) mod.modResults.SparkAppEntities = appEntityDeclarations(declared, languages);
    return mod;
  });
  return withXcodeProject(config, mod => {
    const { projectRoot, platformProjectRoot } = mod.modRequest;
    const included = selection(projectRoot);
    // A production build links only the packages the app's JavaScript imports.
    if (included && !included.includes(PACKAGE))
      throw new Error(`macos.appIntents declares intents, but the app never imports @legendapp/spark/app-intents to handle them`);
    const Xcodeproj = xcodeproj();
    const projectName = Xcodeproj.getProjectName(projectRoot, "macos");
    const files = { [FILE]: appIntentsSwift(declared, languages), ...appIntentsStrings(declared, languages) };
    // The template's project also has an iOS target; the macOS app target is named after its source folder.
    const targetUuid = Object.entries(mod.modResults.pbxNativeTargetSection())
      .find(([key, target]) => !key.endsWith("_comment") && String(target.name).replace(/"/g, "") === projectName)?.[0];
    for (const [file, contents] of Object.entries(files)) {
      if (contents === undefined) continue;
      fs.writeFileSync(path.join(platformProjectRoot, projectName, file), contents);
      // The files sit in the app target's group, whose path is its folder.
      if (mod.modResults.hasFile(file)) continue;
      if (!targetUuid) throw new Error(`The generated Xcode project has no ${projectName} target to compile App Intents into`);
      mod.modResults = Xcodeproj.addFileToGroupAndLink({
        filepath: file, groupName: projectName, project: mod.modResults, targetUuid,
        addFileToProject({ project, file: reference }) {
          project.addToPbxFileReferenceSection(reference);
          project.addToPbxBuildFileSection(reference);
          if (file === FILE) project.addToPbxSourcesBuildPhase(reference);
          else { reference.lastKnownFileType = "text.json.xcstrings"; project.addToPbxResourcesBuildPhase(reference); }
        },
      });
    }
    return mod;
  });
}

/** Fails a build whose app lacks the metadata of an intent, enum or entity it declares: the system would not know it. */
function checkAppIntentsMetadata(app, macos) {
  if (!macos?.appIntents?.length) return;
  const file = path.join(app, "Contents/Resources/Metadata.appintents/extract.actionsdata");
  const metadata = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const extracted = [...Object.keys(metadata.actions ?? {}), ...(metadata.enums ?? []).map(type => type.identifier), ...Object.keys(metadata.entities ?? {})];
  const missing = [...macos.appIntents.map(intent => structName(intent.id)), ...(macos.appEnums ?? []).map(type => enumName(type.id)), ...(macos.appEntities ?? []).map(type => entityName(type.id))]
    .filter(name => !extracted.includes(name));
  if (missing.length) throw new Error(`The build lacks App Intents metadata for ${missing.join(", ")} in Contents/Resources/Metadata.appintents: Xcode did not extract the intents macos.appIntents declares (docs/app-intents.md#build).`);
}

module.exports = { validateAppIntents, appIntentDeclarations, appEntityDeclarations, appIntentsStrings, appIntentsSwift, withAppIntents, checkAppIntentsMetadata };
