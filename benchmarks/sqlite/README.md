# SQLite provider benchmark

Compare the actual OP-SQLite 18.2.1 and NitroSQLite 10.0.0 native implementations through Hermes and Spark's database adapter. See [the measured report](../../docs/sqlite-benchmark-2026-10-01.md) and [raw results](results-2026-10-01.json).

Run from the Spark root on macOS with Xcode command-line tools, Python 3, Bun, and the existing workspace dependencies:

```sh
python3 benchmarks/sqlite/run.py
```

The script reuses Hermes from an existing macOS build. If the default paths do not exist, point at matching Hermes headers and a directory containing `hermes.framework`:

```sh
python3 benchmarks/sqlite/run.py \
  --hermes-headers /path/to/hermes-engine/destroot/include \
  --hermes-frameworks /path/to/App.app/Contents/Frameworks
```

Builds, downloaded package sources, fixture databases, and new results stay under `.spark/benchmarks/sqlite`. Nothing installs into the workspace dependencies or changes the application's SQLite provider. The pinned npm archive is checked against its SHA-512 integrity. The script enforces a 50 GB free-space reserve and retains a handle for cancelling its own child processes if that reserve is reached.

`host.cpp` installs the real providers and pumps native callbacks and Hermes microtasks. `bundle.ts` uses each provider's query wrappers, bridges the already-installed native objects, and applies the React Native Babel preset. `suite.ts` runs value, transaction, reader isolation, persistence and lifecycle checks, then consumes and validates every timed query result. `run.py` compiles separate executables so their bundled SQLite implementations cannot collide, alternates providers, and collects timing/RSS evidence.

This is a repeatable database/binding benchmark, not a substitute for full React Native app startup, CocoaPods integration, or interactive UI acceptance. The committed data is the October 1 evaluation; rerunning writes new measurements under `.spark`.
