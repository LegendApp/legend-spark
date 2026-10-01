# NitroSQLite 10 versus Spark's OP-SQLite backend

October 1, 2026. **Keep OP-SQLite 18.2.1 for Spark.** NitroSQLite 10.0.0 works in the native macOS benchmark, but it is 19–40% slower through Spark's existing database contract on the measured query/write workloads. It provides no substantial performance win that justifies replacing the backend. Native batching is essentially tied; prepared synchronous queries are close.

This evaluation does not change Spark's backend or public API. The reproducible harness is in [benchmarks/sqlite](../benchmarks/sqlite/README.md), with [raw measurements and configuration](../benchmarks/sqlite/results-2026-10-01.json).

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
