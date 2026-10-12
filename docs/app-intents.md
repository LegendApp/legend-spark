# App Intents and Shortcuts

`@legendapp/spark/app-intents` offers the app's actions to Shortcuts, Spotlight and Siri. The app declares each
action (an App Intent) in its configuration; `spark build` compiles it into the app, and a JavaScript handler runs it.

```json
"macos": {
  "bundleIdentifier": "com.example.recipes",
  "appIntents": [{
    "id": "showRecipe",
    "title": "Show Recipe",
    "description": "Shows how to make a recipe.",
    "parameters": [{ "name": "recipe", "title": "Recipe", "type": "string" }, { "name": "servings", "title": "Servings", "type": "integer", "optional": true }],
    "returnsText": true,
    "shortcut": { "phrases": ["Show a recipe in ${applicationName}"], "shortTitle": "Show Recipe", "systemImage": "fork.knife" }
  }]
}
```

```ts
import { addAppIntentHandler, donateAppIntent, getAppIntentsAvailability } from '@legendapp/spark/app-intents';

const registration = await addAppIntentHandler('showRecipe', async ({ parameters }) => {
  const recipe = await loadRecipe(String(parameters.recipe));
  return `${recipe.name} for ${parameters.servings ?? 1}: ${recipe.steps}`;
});
await donateAppIntent('showRecipe', { recipe: 'Pancakes', servings: 2 });
await registration.remove();
```

## Declaring intents

`macos.appIntents` in `desktop.config.json` (or `expo.macos.appIntents`) lists the intents:

| Field | |
| --- | --- |
| `id` | Letters and digits, starting with a letter. It is the intent's identity: shortcuts that use it stop working when it changes. |
| `title`, `description` | What Shortcuts shows. |
| `parameters` | `{ name, title, type, optional? }`; `type` is `string`, `number`, `integer` or `boolean`. Names are letters and digits starting with a lowercase letter. Shortcuts asks for required parameters it does not have. |
| `returnsText` | The handler returns text, which the system shows and passes to the next action. Default `false`: the handler returns nothing. |
| `openApp` | Bring the app to the front when the intent runs. Default `false`. |
| `shortcut` | An App Shortcut: offered in Shortcuts, Spotlight and Siri without setup. Each phrase names the app once as `${applicationName}`; `systemImage` is an SF Symbol name. At most 10. |

Titles and phrases are used as written; they are not localized yet (#416).

## Build

The system only runs intents compiled into the app: Xcode's "Extract App Intents Metadata" step reads Swift types
that conform to `AppIntent` and writes `Contents/Resources/Metadata.appintents`, which macOS reads when it registers
the app. JavaScript cannot add intents at run time. So when `macos.appIntents` declares any, the Spark config plugin:

- generates `SparkAppIntents.swift` into the app target: one `AppIntent` per intent, an `AppShortcutsProvider` for
  the shortcuts, and the `SparkGeneratedAppIntents` class that donates them. Each intent's `perform()` calls
  `SparkAppIntentsBridge` in the `RNDesktopAppIntents` pod (`import RNDesktopAppIntents`; the pod is a module whose
  only public header is that bridge);
- lists the intents in Info.plist under `SparkAppIntents`, which the JavaScript API reads.

`spark build` regenerates both whenever the configuration changes; do not edit them. The app must import
`@legendapp/spark/app-intents`: a production build links only the native packages its JavaScript imports, and the
plugin fails the build when the intents would have nothing to run them.

The Spark Runner is prebuilt, so it carries no app's intents: run `spark build` (or `spark dev` with a development
build). Declaring intents makes the app need a custom build.

## Handling intents

`getAppIntentsAvailability()` is `{ available: true }` in a build with the app's intents and their metadata. The
Spark Runner, an app that declares none, or a build without the generated intents or `Metadata.appintents` report
`host-restriction`; the calls then reject `E_UNAVAILABLE` with the reason. `getAppIntents()` lists the declared intents.

`addAppIntentHandler(id, handler, { onError? })` resolves once `handler` receives the intent's invocations: `{ id,
parameters }`, with every declared parameter (an optional one the person left empty is `null`). The handler returns
the result text for an intent with `returnsText` and nothing otherwise; a mismatch fails the invocation with
`E_INVALID_DATA`. Throwing fails the intent: Shortcuts shows the error's message. Parameters are checked against the
declaration before the handler runs. An undeclared id rejects `E_NOT_FOUND`, a second handler for one id `E_BUSY`.

Each invocation completes once. It waits up to 30 seconds from its start for an answer, including the time it waits
for a handler: when an intent launches the app, the invocation waits until JavaScript registers the handler (at most
20 wait at a time; more fail `E_BUSY`). Then the system gets `E_TIMEOUT`, and a late answer reaches `onError` as
`E_CLOSED`. `remove()` fails the invocations the handler has not answered with `E_CLOSED`; a JavaScript reload
removes the runtime's handlers.

When the app is not running, macOS launches it to run the intent, and the invocation waits for the handler as above.

## Donations

`donateAppIntent(id, parameters?)` tells the system the person just did what the intent does, so Siri and Spotlight
can suggest it later (`IntentDonationManager`). It resolves once the system has the donation; parameters are checked
as for an invocation; a failure the system reports rejects `E_NATIVE`.

## Testing

In driver mode (the in-app test driver, [test-driver.md](test-driver.md)) App Intents are simulated in the app's
memory: Info.plist is never read, the driver declares the intents and runs them as the system would, and donations
are recorded instead of reaching `IntentDonationManager`. Two driver commands, built only with the driver:

- `{"command": "simulateAppIntents", "intents"?, "invoke"?}`. `intents` replaces the declared intents, in the
  Info.plist form: `[{ id, title, returnsText, parameters: [{ name, title, type, optional }] }]`. `invoke: { id,
  parameters?, timeoutMs? }` runs an intent through the same path as the generated Swift; it completes on its own.
- `{"command": "testAppIntents"}` replies `appIntents`: `declared` and `registered` ids, `invocations` (completed,
  each `{ id, parameters, text?, error?: { code, message } }`), `pending` and `donations`.

Flows use them as `simulateAppIntents` and `assertAppIntents` ([e2e-flow-commands.md](e2e-flow-commands.md)).
`tests/app-intents-build.test.ts` runs Xcode's compiler and metadata processor on the generated Swift and checks
the intents, parameters and App Shortcuts in `Metadata.appintents`; `tests/app-intents.native.mm` runs the native
invocation path. Running intents from Shortcuts, Spotlight and Siri is checked only by the manual flow
`e2e/flows/system-integration/app-intents-real.yaml`.

### Kitchen Sink

System integration > App Intents & Shortcuts (`spark-ks://system-integration/app-intents`) handles two intents,
`ksShowRecipe` (returns text) and `ksStartTimer` (fails over 60 minutes), and donates Show Recipe. The Kitchen Sink
declares no intents, so its builds never add actions to Shortcuts, Spotlight or Siri: driver flows declare them
through the simulation. For the manual flow, add this block to `examples/kitchen-sink/desktop.config.json`
(`KS_APP_INTENTS` in `screens/system-integration/app-intents-config.ts`), rebuild, and remove it afterwards:

```json
"appIntents": [
  { "id": "ksShowRecipe", "title": "Show Kitchen Sink Recipe", "description": "Shows how to make a recipe for some servings.", "returnsText": true,
    "parameters": [{ "name": "recipe", "title": "Recipe", "type": "string" }, { "name": "servings", "title": "Servings", "type": "integer", "optional": true }],
    "shortcut": { "phrases": ["Show a recipe in ${applicationName}"], "shortTitle": "Show Recipe", "systemImage": "fork.knife" } },
  { "id": "ksStartTimer", "title": "Start Kitchen Sink Timer", "parameters": [{ "name": "minutes", "title": "Minutes", "type": "number" }] }
]
```

## Platforms

| Platform | Availability |
| --- | --- |
| macOS | Available in builds of apps that declare intents; `host-restriction` in the Spark Runner. |
| Windows | `getAppIntentsAvailability()` reports `unsupported-platform`; the other functions reject `E_UNSUPPORTED_PLATFORM` after validating their arguments. Windows App Actions: #415. |
