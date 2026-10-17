# App Intents and Shortcuts

`@legendapp/spark/app-intents` offers the app's actions to Shortcuts, Spotlight and Siri. The app declares each
action (an App Intent) in its configuration, with the enums and entities its parameters take; `spark build` compiles
them into the app, and JavaScript handlers run the actions and answer entity queries.

```json
"localizations": ["en", "ar"],
"macos": {
  "bundleIdentifier": "com.example.recipes",
  "appEnums": [{ "id": "Recipe", "title": { "en": "Recipe", "ar": "وصفة" },
    "cases": [{ "value": "pancakes", "title": { "en": "Pancakes", "ar": "فطائر" } }, { "value": "soup", "title": { "en": "Soup", "ar": "حساء" } }] }],
  "appEntities": [{ "id": "Note", "title": { "en": "Note", "ar": "ملاحظة" } }],
  "appIntents": [{
    "id": "showRecipe",
    "title": { "en": "Show Recipe", "ar": "اعرض الوصفة" },
    "description": "Shows how to make a recipe.",
    "parameters": [{ "name": "recipe", "title": { "en": "Recipe", "ar": "وصفة" }, "type": "Recipe" }, { "name": "servings", "title": "Servings", "type": "integer", "default": 1 }],
    "parameterSummary": { "en": "Show ${recipe} for ${servings}", "ar": "اعرض ${recipe} لـ ${servings}" },
    "returnsText": true,
    "shortcut": { "phrases": [{ "en": "Show ${recipe} in ${applicationName}", "ar": "اعرض ${recipe} في ${applicationName}" }], "shortTitle": "Show Recipe", "systemImage": "fork.knife" }
  }, {
    "id": "openNote", "title": "Open Note", "openApp": true, "parameters": [{ "name": "note", "title": "Note", "type": "Note" }]
  }]
}
```

```ts
import { addAppEntityQueryHandler, addAppIntentHandler, donateAppIntent } from '@legendapp/spark/app-intents';

const recipes = await addAppIntentHandler('showRecipe', async ({ parameters }) => {
  const recipe = await loadRecipe(String(parameters.recipe)); // "pancakes" or "soup"
  return `${recipe.name} for ${parameters.servings}: ${recipe.steps}`;
});
const notes = await addAppEntityQueryHandler('Note', async query => {
  const all = await loadNotes();
  const found = query.kind === 'identifiers' ? all.filter(note => query.identifiers.includes(note.id))
    : query.kind === 'search' ? all.filter(note => note.title.includes(query.text)) : all.slice(0, 10);
  return found.map(note => ({ id: note.id, title: note.title, subtitle: note.folder }));
});
const opener = await addAppIntentHandler('openNote', ({ parameters }) => { showNote(String(parameters.note)); });
await donateAppIntent('showRecipe', { recipe: 'pancakes', servings: 2 });
await Promise.all([recipes.remove(), notes.remove(), opener.remove()]);
```

## Declaring intents

`macos.appIntents` in `desktop.config.json` (or `expo.macos.appIntents`) lists the intents:

| Field | |
| --- | --- |
| `id` | Letters and digits, starting with a letter. It is the intent's identity: shortcuts that use it stop working when it changes. |
| `title`, `description` | What Shortcuts shows. |
| `parameters` | `{ name, title, type, optional?, default? }`; `type` is `string`, `number`, `integer`, `boolean`, or the id of an enum or entity. Names are letters and digits starting with a lowercase letter. Shortcuts asks for required parameters it does not have; `default` is the value it starts with (of the parameter's type, an enum's case value; entities have none). |
| `parameterSummary` | How Shortcuts shows the action in a shortcut, naming parameters as `${name}`: `Show ${recipe} for ${servings}`. |
| `returnsText` | The handler returns text, which the system shows and passes to the next action. Default `false`: the handler returns nothing. |
| `openApp` | Bring the app to the front when the intent runs. Default `false`. |
| `shortcut` | An App Shortcut: offered in Shortcuts, Spotlight and Siri without setup. Each phrase names the app once as `${applicationName}`, and may name enum parameters as `${name}`: the system then offers the phrase for each case (Show Pancakes in Recipes). `systemImage` is an SF Symbol name. At most 10. |

### Enums

`macos.appEnums` lists `{ id, title, cases: [{ value, title }] }`. A parameter whose `type` is the enum's id takes one
of its cases: Shortcuts offers them in a picker under their titles, and the handler gets the case's `value`. Ids are
letters and digits starting with an uppercase letter, unique across enums and entities; values letters and digits
starting with a lowercase letter.

### Entities

`macos.appEntities` lists `{ id, title }`: things in the app the person picks, such as notes or documents, whose
`title` names the kind. A parameter whose `type` is the entity's id takes one of them, and the handler gets its id.
JavaScript knows the entities: `addAppEntityQueryHandler(entity, handler)` answers the system's queries with
`{ id, title, subtitle? }` lists. A query asks for the entities with some ids (`{ kind: "identifiers", identifiers }`:
Shortcuts shows or runs an intent with entities it saved), the ones to suggest in a picker (`{ kind: "suggested" }`), or
the ones matching what the person typed (`{ kind: "search", text }`). Return only entities that exist; an id the
handler does not know is left out. Queries wait for the handler and complete once, as invocations do (below). A
result that is not such a list, with unique ids, fails the query with `E_INVALID_DATA`.

App Shortcut phrases cannot name entity parameters.

### Translations

A `title`, `description`, `parameterSummary`, `shortTitle`, phrase, enum, case or entity title is text as written, or
text for each of the app's `localizations` (all of them, and only those): `{ "en": "Recipe", "ar": "وصفة" }`. Shortcuts,
Spotlight and Siri then show it in the person's language. `spark build` compiles the translations into two strings
catalogs in the app target, keyed by the development language's text (the first in `localizations`):
`SparkAppIntents.xcstrings`, the table every generated title reads from, and `AppShortcuts.xcstrings`, where the
system looks for translated phrases. A translated phrase or summary uses the same `${...}` placeholders in every
language. Text written once is shown as written in every language. One development-language text cannot have two
different translations.

## Build

The system only runs intents compiled into the app: Xcode's "Extract App Intents Metadata" step reads Swift types
that conform to `AppIntent` and writes `Contents/Resources/Metadata.appintents`, which macOS reads when it registers
the app. JavaScript cannot add intents at run time. So when `macos.appIntents` declares any, the Spark config plugin:

- generates `SparkAppIntents.swift` into the app target: one `AppEnum` per enum, an `AppEntity` and its
  `EntityStringQuery` per entity, one `AppIntent` per intent, an `AppShortcutsProvider` for the shortcuts, and the
  `SparkGeneratedAppIntents` class that donates them. Each intent's `perform()` and each query calls
  `SparkAppIntentsBridge` in the `RNDesktopAppIntents` pod (`import RNDesktopAppIntents`; the pod is a module whose
  only public header is that bridge);
- adds the strings catalogs of the translated titles and phrases ([Translations](#translations)) to the app target's
  resources;
- lists the intents in Info.plist under `SparkAppIntents`, and the entities under `SparkAppEntities`, which the
  JavaScript API reads.

`spark build` regenerates them whenever the configuration changes; do not edit them. It fails a build whose
`Metadata.appintents` lacks a declared intent, enum or entity. The app must import
`@legendapp/spark/app-intents`: a production build links only the native packages its JavaScript imports, and the
plugin fails the build when the intents would have nothing to run them.

The Spark Runner is prebuilt, so it carries no app's intents: run `spark build` (or `spark dev` with a development
build). Declaring intents makes the app need a custom build.

## Handling intents

`getAppIntentsAvailability()` is `{ available: true }` in a build with the app's intents and their metadata. The
Spark Runner, an app that declares none, or a build without the generated intents or `Metadata.appintents` report
`host-restriction`; the calls then reject `E_UNAVAILABLE` with the reason. `getAppIntents()` lists the declared intents.

`addAppIntentHandler(id, handler, { onError? })` resolves once `handler` receives the intent's invocations: `{ id,
parameters }`, with every declared parameter (an optional one the person left empty is `null`; an enum's is its case
value, an entity's its id). The handler returns
the result text for an intent with `returnsText` and nothing otherwise; a mismatch fails the invocation with
`E_INVALID_DATA`. Throwing fails the intent: Shortcuts shows the error's message. Parameters are checked against the
declaration before the handler runs. An undeclared id rejects `E_NOT_FOUND`, a second handler for one id `E_BUSY`.

`addAppEntityQueryHandler(entity, handler, { onError? })` does the same for an entity's queries
([Entities](#entities)): an entity macos.appEntities does not declare rejects `E_NOT_FOUND`, a second query handler
`E_BUSY`.

Each invocation and query completes once. It waits up to 30 seconds from its start for an answer, including the time it waits
for a handler: when an intent launches the app, the invocation waits until JavaScript registers the handler (at most
20 wait at a time; more fail `E_BUSY`). Then the system gets `E_TIMEOUT`, and a late answer reaches `onError` as
`E_CLOSED`. `remove()` fails the invocations the handler has not answered with `E_CLOSED`; a JavaScript reload
removes the runtime's handlers.

When the app is not running, macOS launches it to run the intent, and the invocation waits for the handler as above.

## Donations

`donateAppIntent(id, parameters?)` tells the system the person just did what the intent does, so Siri and Spotlight
can suggest it later (`IntentDonationManager`). It resolves once the system has the donation; parameters are checked
as for an invocation (an enum's is its case value, an entity's its id, which the entity's query handler resolves); a
failure the system reports rejects `E_NATIVE`.

## Testing

In driver mode (the in-app test driver, [test-driver.md](test-driver.md)) App Intents are simulated in the app's
memory: Info.plist is never read, the driver declares the intents and runs them as the system would, and donations
are recorded instead of reaching `IntentDonationManager`. Two driver commands, built only with the driver:

- `{"command": "simulateAppIntents", "intents"?, "entities"?, "invoke"?, "query"?}`. `intents` replaces the declared
  intents, in the Info.plist form: `[{ id, title, returnsText, parameters: [{ name, title, type, values?, entity?,
  optional, default? }] }]`; `entities` the declared entities, `[{ id, title }]`. `invoke: { id, parameters?,
  timeoutMs? }` runs an intent, and `query: { entity, kind, identifiers?, text?, timeoutMs? }` asks an entity's query,
  through the same path as the generated Swift; each completes on its own.
- `{"command": "testAppIntents"}` replies `appIntents`: `declared` and `registered` intent ids, `entities` and
  `registeredEntities`, `invocations` (completed, each `{ id, parameters, text?, error?: { code, message } }`),
  `queries` (completed, each `{ entity, query, entities?, error? }`), `pending` and `donations`.

Flows use them as `simulateAppIntents` and `assertAppIntents` ([e2e-flow-commands.md](e2e-flow-commands.md)).
`tests/app-intents-build.test.ts` runs Xcode's compiler and metadata processor on the generated Swift and checks
the intents, parameters, defaults, summaries, enums, entities and App Shortcuts in `Metadata.appintents`, and compiles
the strings catalogs to check that every language has each title the metadata looks up; `tests/app-intents.native.mm`
runs the native invocation and query path. Running intents from Shortcuts, Spotlight and Siri is checked only by the manual flow
`e2e/flows/system-integration/app-intents-real.yaml`.

### Kitchen Sink

System integration > App Intents & Shortcuts (`spark-ks://system-integration/app-intents`) handles three intents,
`ksShowRecipe` (a `KsRecipe` enum parameter and a Servings default; returns text), `ksStartTimer` (fails over 60
minutes) and `ksOpenNote` (a `KsNote` entity parameter), answers `KsNote` queries from three notes, and donates Show
Recipe. Every title is in English, Arabic and French. The Kitchen Sink declares no intents, so its builds never add
actions to Shortcuts, Spotlight or Siri: driver flows declare them through the simulation. For the manual flow, add
`KS_APP_INTENTS`, `KS_APP_ENUMS` and `KS_APP_ENTITIES` from `screens/system-integration/app-intents-config.ts` to the
`macos` block of `examples/kitchen-sink/desktop.config.json` as `appIntents`, `appEnums` and `appEntities` (as JSON),
rebuild, and remove them afterwards.

## Platforms

| Platform | Availability |
| --- | --- |
| macOS | Available in builds of apps that declare intents; `host-restriction` in the Spark Runner. |
| Windows | `getAppIntentsAvailability()` reports `unsupported-platform`; the other functions, `addAppEntityQueryHandler` included, reject `E_UNSUPPORTED_PLATFORM` after validating their arguments. Windows App Actions: #415. |
