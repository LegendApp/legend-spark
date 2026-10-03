# Legend Frame rename validation — 2026-09-18

The public package is `@legendapp/spark`, its executable is `frame`, and internal
packages use `@legendapp/frame-*`. Native names, codegen registrations, Windows
projects, templates, configuration helpers, environment variables, runtime files,
workspace patches, tests and documentation were renamed together.

Verified on Apple Silicon macOS:

- Workspace TypeScript and **252 unit tests** (1,434 assertions).
- Node entry point in the public package starts the Bun CLI and prints Legend Frame
  help with `frame` commands; package exports resolve for UI, audio, auth, files and
  windows.
- Packed Mac and Windows starters create through Expo Desktop, install dependencies,
  initialize identity, preserve configuration on repeated initialization, and
  typecheck. The direct universal Expo Desktop template passes the same checks.
- Creation through the public package executable produces a fresh Mac consumer.
  Its installed public executable works, and the consumer typechecks after refreshing
  to the final SDK archives.
- Windows ARM64 feature-project generation and JavaScript bundle; all 18 renamed
  Windows solution project paths resolve. A regression also checks local compile,
  header, IDL and resource references, including renamed UTF-16 resource scripts. This is preparation evidence, not MSBuild
  or Windows runtime execution.
- Fresh native macOS Debug compilation, launch, and **nine native keyboard checks**.
- Full Kitchen Sink bundle and **six native UI checks**: button hit target/layout,
  callback delivery once, disabled/dynamic labels, remount/re-enable, text editing
  and defaults, selection with duplicate labels and reordered options.

The template check exposed a packaging bug: relative SDK archive dependencies were
not included in the extracted template. Templates now carry the archives under
`sdk/`, so direct Expo Desktop creation does not depend on a warmed package cache
or on producer-machine paths. Both wrapper creation and direct creation were tested.

## Environment and artifacts

Opening the parent `Documents` directory stalled in Bun, Node and Python during
this session, while individual checkout files remained readable. Stalled commands
were stopped. Validation ran against a source copy at `/tmp/FrameRenameVerification`,
outside that directory; no OS permissions or security settings were changed.

Reports/logs include:

- `/tmp/frame-final-tests.log`, `/tmp/frame-final-typecheck.log`
- `/tmp/frame-template-tests-2.log`
- `/tmp/frame-windows-prepare-final.log`
- `/tmp/frame-public-create.log`, `/tmp/frame-public-help.log`, `/tmp/frame-public-typecheck.log`
- `/tmp/FrameRenameVerification/.frame/keyboard-tests/report.json`
- `/tmp/FrameRenameVerification/.frame/renamed-ui-report.json`

The verification copy occupies approximately 6.5 GiB; fresh consumers and template
checks occupy several additional GiB (some package data is shared by hardlinks).
The verification copy, native build products and generated consumers are retained
for inspection and are disposable. They were not added to Git. Existing prototype
runtime binaries are incompatible and must be rebuilt; see the
[migration guide](legend-spark-migration.md).

Windows native compilation/execution, published npm installation, hosted runtime
downloads and standalone release acceptance are **not** established by this run.
The rename does not add distribution or change default starter selection.
