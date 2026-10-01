# NitroSQLite 10 versus Spark's OP-SQLite backend

October 1, 2026. **Keep OP-SQLite 18.2.1 for Spark and remove redundant adapter work.** NitroSQLite 10.0.0 works in the native macOS benchmark, but it provides no substantial performance win that justifies replacing the backend. The initial evaluation exposed substantial overhead in Spark's wrapper. The follow-up below removes it without changing the public database API.

The reproducible harness is in [benchmarks/sqlite](../benchmarks/sqlite/README.md), with [initial raw measurements](../benchmarks/sqlite/results-2026-10-01.json) and [direct-adapter measurements](../benchmarks/sqlite/results-direct-adapter-2026-10-01.json). The remaining sections retain the original evaluation; this follow-up describes the current implementation.

## Follow-up: direct Spark adapter

Spark was duplicating the driver's native statement queue, copying bindings already snapshotted by the driver, rebuilding every returned row and BLOB, and layering async pass-through functions over every query. `getFirst` also converted every returned row before selecting the first. These costs were implementation choices, not requirements of a stable public API.

Ordinary queries now enter the native queue immediately. The adapter validates the contract and converts only the requested results in the driver's fresh objects, using byte views instead of copying buffers. JavaScript coordination remains for multi-statement transaction ownership, transaction failure semantics and draining accepted work on close. Bindings are copied only when Spark actually delays submission behind a transaction. OP's native code snapshots supplied parameters before enqueueing them; the native benchmark verifies byte-view offsets and mutation immediately after submission.

The rerun uses the same host, fixture, durability and 21-sample method. OP's benchmark backend now exactly matches Spark's production call. The initial benchmark included an extra async normalization shim for OP as well as Nitro; that contributed roughly 0.8 ms per 1,000 reads in a separate diagnostic run. Before/after measurements below therefore include removing that shim. They are successive runs, rather than paired samples, and machine scheduling affects the async timings.

| Workload | Original Spark + OP ms | Direct adapter + OP ms | Direct adapter + Nitro ms |
|---|---:|---:|---:|
| 1,000 point reads | 26.17 | 13.94 | 22.89 |
| 100 filtered pages | 5.92 | 3.01 | 3.99 |
| 20,000 narrow rows | 44.20 | 14.94 | 22.81 |
| 20,000 wide rows | 108.91 | 44.54 | 71.36 |
| Transaction: 1,000 inserts | 20.35 | 15.14 | 23.74 |
| 100 FULL-durability autocommits | 4.14 | 4.48 | 4.48 |

In this rerun direct OP async point reads take **13.10 ms**, compared with Spark's **13.94 ms**. The residual cost is about **0.84 microseconds per read** on this workload; it is not zero, and is not a universal per-call cost. A separate same-host diagnostic run comparing the old production wrapper, new wrapper and direct backend measured 25.31, 13.90 and 12.30 ms respectively over nine samples each. Removing the benchmark shim alone cannot account for the improvement.

Median process peak RSS fell from 208.8 to **183.0 MB for OP**, and from 265.5 to **233.4 MB for Nitro**. Wide-row timer delay fell from 98.85 to **40.57 ms for OP**. These remain whole-host measurements, not isolated adapter allocations or UI frame measurements. Both providers pass the native correctness checks. Nitro remains slower on the read and transaction workloads; autocommit is effectively tied in this rerun.

Regression tests enforce immediate ordinary submission, result/buffer ownership, parameter snapshots, transaction ordering and close draining. [The API design rules](api-design.md#direct-adapters-and-execution-cost) now require adapters to use implementation guarantees where they satisfy Spark's contract and justify any additional coordination or copying.

## Method

- Apple M4, 16 GB RAM, macOS 26.6.1, arm64. Existing Spark macOS Hermes framework (release build for RN 0.81.6, bytecode 96, Hades concurrent GC), RN 0.81.6 JSI headers, Nitro Modules 0.35.7. C/C++ compiled with `-O3 -DNDEBUG` and C++20.
- Actual published NitroSQLite 10.0.0 source and Spark's installed, patched OP-SQLite 18.2.1 source. Use each library's public managed query wrapper and native bindings. Only native startup is supplied by the harness.
- Same `createDatabase` implementation used by Spark, with the minimal backend adaptation needed to turn Nitro's `rows._array` into row arrays. OP uses the same `execute` method as Spark. The wrapper's queue, validation, transactions, and row/blob copies remain in both measurements.
- Same deterministic 20,000-row database, indexes, SQL, positional parameters, and checksums. Wide rows include Unicode text, a short text body, numbers, NULL, and a small BLOB. Both use WAL, `synchronous=FULL`, and a 5-second busy timeout. This is an explicitly matched durability profile, not a measurement of either library's initial journal defaults.
- Three fresh host processes per provider, alternating Nitro/OP, OP/Nitro, Nitro/OP. Every case has one unmeasured warmup and seven measured executions per process: 21 samples per provider/case. Tables report medians; raw data also contains per-process measurements and observed p10/p90 values.
- Library default compilation settings: OP performance mode off, Nitro performance mode on. Bundled SQLite versions reported by SQL are **3.51.3 for OP** and **3.49.0 for Nitro**. These are comparisons of the shipping implementations, not an isolated measurement of JSI versus Nitro with the same SQLite source and flags.
- Setup, seed generation, and prepared statement creation are outside timed regions. Write cases include deleting the previous fixture rows and a cardinality check where present. Results are consumed and checked, so this measures materialized results rather than unused lazy objects.

## Results

Times are milliseconds for the whole workload. The final column is Nitro time divided by OP time; greater than 1 means Nitro took longer.

| Workload | OP-SQLite ms | NitroSQLite ms | Nitro / OP |
|---|---:|---:|---:|
| `spark.point-read` | 26.17 | 32.98 | 1.26× |
| `spark.filtered-pages` | 5.92 | 7.05 | 1.19× |
| `spark.bulk-narrow` | 44.20 | 53.26 | 1.20× |
| `spark.bulk-wide` | 108.91 | 132.47 | 1.22× |
| `spark.transaction-insert` | 20.35 | 28.39 | 1.40× |
| `spark.autocommit-full` | 4.14 | 5.00 | 1.21× |
| `raw.async-point-read` | 11.78 | 19.41 | 1.65× |
| `raw.async-fanout` | 5.50 | 15.86 | 2.88× |
| `raw.sync-point-read` | 2.60 | 4.35 | 1.67× |
| `raw.prepared-sync-point` | 2.88 | 3.04 | 1.06× |
| `raw.prepared-async-point` | 20.81 | 18.64 | 0.90× |
| `raw.prepared-async-sync-bind` | 9.78 | 17.42 | 1.78× |
| `raw.batch-insert` | 22.61 | 22.29 | 0.99× |
| `spark.bulk-wide-timer-delay` | 98.85 | 117.81 | 1.19× |
| `spark.bulk-wide-js-pause` | 107.37 | 131.75 | 1.23× |

Point cases perform 1,000 indexed lookups; filtered pages perform 100 queries of 20 rows each. Bulk cases materialize 20,000 rows. The Spark transaction inserts 1,000 rows; autocommit inserts 100 rows with FULL durability. The native batch inserts 10,000 rows atomically. Fanout submits 1,000 queries with `Promise.all`.

The full benchmark process peaks at a median **208.8 MB RSS for OP versus 265.5 MB for Nitro**, approximately 27% more for Nitro. This includes the host, fixture arrays, all workloads, native allocations, and Hermes GC; it is not an isolated per-query memory measurement or a full application's memory footprint.

### Prepared statements and batching

Nitro's prepared async method binds parameters and executes in one call. Against OP's fully asynchronous `await bind(); await execute()` sequence it wins by about 10% (18.64 versus 20.81 ms). OP's supported `bindSync()` followed by async execution is faster than either fully asynchronous sequence (9.78 ms). Binding a few values synchronously does not perform the SQL query synchronously. Neither prepared statement API is currently exposed by Spark.

Native batches deliver around **440,000 rows/second** in both providers, versus roughly **49,000 rows/second** for individual inserts through Spark's transaction executor in OP. Those are different batch sizes and include fixture housekeeping, so this is an approximate throughput comparison, not a controlled 9× claim for every application. If large imports become a real workload, a Spark-owned batch API is a more promising next improvement than a backend swap.

Both libraries take about 100 ms or more of maximum timer delay while materializing the wide 20,000-row result through Spark. Async SQL execution alone does not make large result conversion free on the JS thread. Paginated results are the better application design here. Timer delay in this headless host is a responsiveness indicator, not a UI frame-rate measurement.

## Correctness and compatibility

Both pass the benchmark's checks for Unicode/NULL/BLOB roundtrips, change counts and insert IDs, transaction commit and rollback, transaction ownership errors, native SQL error translation, row cardinality/checksums, persistence after reopening read-only, and rejection after closing. Both also allow an independent reader to read committed data while a writer has an uncommitted transaction. Nitro uses its new `connection: 'independent'` option; OP opens another native handle to the file.

NitroSQLite 10's macOS support, prepared statements, and independent connections are confirmed by the [v10 release notes](https://github.com/margelo/react-native-nitro-sqlite/releases/tag/v10.0.0). OP already provides macOS support, prepared statements, and atomic batches in its [installation documentation](https://op-engineering.github.io/op-sqlite/docs/installation/) and [API reference](https://op-engineering.github.io/op-sqlite/docs/api/). The feature additions in Nitro are valuable, but they do not by themselves establish an advantage over Spark's current backend.

## Scope and recommendation

This is a **native macOS Hermes benchmark**, not Bun/Node SQLite or a mock. It runs real database workers and binding/result conversion code. It does not build a React Native app through CocoaPods, exercise Nitro's Apple startup/path-selection module, measure cold app launch, test iOS/Android, or prove full integration with Spark's project-scoped database paths. A backend replacement would still require those integration checks.

Spark's current SQLite consumers are examples and contract tests; no production Legend Apps SQLite workload was identified. These deterministic workloads represent common database access patterns rather than an existing app's measured usage. The host's event loop substitutes for React Native's CallInvoker scheduler and can influence absolute async latency. Generalize the relative result only to these workloads on this machine.

**Recommendation:** retain OP-SQLite, preserve Spark's backend-independent database contract, and add native batching or prepared execution only when an application needs them. Reconsider Nitro for a concrete correctness, integration, or feature benefit, or if measurements in a consuming app show a win. This benchmark does not support switching for speed.
