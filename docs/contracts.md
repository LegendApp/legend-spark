# Shared contracts

`@legendapp/spark/contracts` exports the error class and the result shapes that every Spark capability shares. It never loads native code, so it is safe to import anywhere, including tests and code that runs where a native module is missing.

```ts
import { SparkError, type Availability, type AsyncRegistration, type Subscription } from '@legendapp/spark/contracts';

try {
  await writeText(path, text); // from '@legendapp/spark/files'
} catch (error) {
  if (error instanceof SparkError && error.code === 'E_PERMISSION_DENIED') showAccessHelp();
  else throw error;
}
```

## Errors

Spark APIs throw or reject with `SparkError`, an `Error` whose `name` is `"SparkError"` and whose `code` is a `SparkErrorCode`. Branch on `code`, never on `message`. A failure that started in native code or another library keeps it as `cause`. Spark's native adapters normalize a native failure that carries no Spark code to `E_NATIVE`.

`SparkErrorCode` is one of `E_INVALID_ARGUMENT`, `E_INVALID_DATA`, `E_UNAVAILABLE`, `E_UNSUPPORTED_PLATFORM`, `E_UNSUPPORTED_OPTION`, `E_MODULE_UNAVAILABLE`, `E_PERMISSION_DENIED`, `E_NOT_FOUND`, `E_NOT_EMPTY`, `E_ALREADY_EXISTS`, `E_READ_ONLY`, `E_NO_SPACE`, `E_BUSY`, `E_CLOSED`, `E_ABORTED`, `E_TIMEOUT` and `E_NATIVE`. Each capability's page and TSDoc name the codes its calls use. Promise APIs reject validation errors; synchronous utilities throw them. The conventions behind these codes are in [API contracts](api-contracts.md#3-shared-api-conventions).

## Availability

`get<Feature>Availability()` functions return `Availability`: `{ available: true }`, or `{ available: false, reason }` with `reason` `"unsupported-platform"`, `"missing-module"` or `"host-restriction"`. The query is advisory: an available feature can still fail at the call, with a `SparkError`.

## Subscriptions and registrations

A synchronous listener returns a `Subscription`, whose `remove()` stops callbacks at once. A registration that needs native setup resolves an `AsyncRegistration`, whose `remove()` returns a promise that settles when native cleanup finishes. Callbacks stop as soon as `remove()` is called, concurrent removals share one cleanup, and a failed cleanup can be retried.
