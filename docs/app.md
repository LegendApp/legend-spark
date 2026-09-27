# Application lifecycle

Import from `@legendapp/spark/app`. Spark owns this desktop lifecycle contract; document history and file/URL launch requests live in `/app/documents`.

`getAppAvailability()` reports unsupported platforms and missing optional native modules without throwing during import. Operations reject with `SparkError` when unavailable. `getAppContext()` returns project identity (`projectId`, `name`, `version`), runtime mode/module versions and the initial process arguments.

`activate()` brings the application forward; `hide()` hides its windows. `quit()` joins an in-progress request and resolves with `{ quitRequested: true }` when shutdown is approved, or `{ quitRequested: false, reason: 'vetoed' }`. Approval is the last observable decision before shutdown: the JavaScript runtime may stop before a continuation executes. Save data in a quit guard, not after awaiting an approved quit.

```ts
import { beforeQuit, quit } from '@legendapp/spark/app';

const guard = await beforeQuit(async () => {
  await documentStore.flush();
  return true;
}, { onError: reportError });

const result = await quit();
if (!result.quitRequested) showUnsavedWork();

// On owner disposal; concurrent removals join and failed cleanup can be retried.
await guard.remove();
```

Every registered guard must return `true`. A false result, thrown/rejected handler, native 30-second deadline, or a guard added/removed during a pending decision vetoes it. Errors are sent to `onError` (default: `console.error`). Removal stops future callbacks immediately; late completions cannot approve a later quit request. Forced process termination cannot be vetoed. Failed registration cleans up its guard; if cleanup also fails, the next registration or programmatic quit retries that cleanup before proceeding.

`addAppListener(type, listener)` returns a synchronous `Subscription` with `remove()`. Events are typed and live-only:

| Event | Additional fields |
| --- | --- |
| `activate`, `deactivate`, `willQuit` | None |
| `reopen` | `hasVisibleWindows`, `mainWindowWasVisible` |
| `secondInstance` | `arguments` from the incoming launch |

All payloads include `type`. `willQuit` is a notification, not an asynchronous cleanup opportunity. Use `getAppContext()` for initial identity and `/app/documents` for replayable open requests. There is no public raw native event stream or separate `/app/exit` API.

Validation: JavaScript tests exercise independent guards, stale replies, concurrent quit calls, invalid native output, and cleanup retries. A native macOS coordinator fixture exercises all-handler approval, joins, vetoes, guard changes and timeouts. The changed macOS bridge/transport passes an Objective-C++ syntax check with RN declarations stubbed. Actual application shutdown and Windows compilation remain pending.
