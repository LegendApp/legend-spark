# Legend Spark naming and prototype migration

The framework is **Legend Spark**; its CLI command is **spark**. The single public
npm package is `@legendapp/spark`, with APIs under subpaths such as
`@legendapp/spark/ui` and `@legendapp/spark/files`. Implementation packages remain
private. Other Legend projects and third-party dependencies retain their names,
including Sparkle (the macOS updater).

## Local development

Use Node 24.19.0 or newer. Bun is optional; generated projects support npm, pnpm,
Yarn, and Bun.

```sh
bun install
bun run spark sdk pack
bun run spark sdk build-runner
bun run spark create /path/to/MyApp
```

Once Spark is published, the entry point will be `npx @legendapp/spark@next create
MyApp`. This merge does not publish Spark or rebuild its Runner. The existing
Frame releases remain available under their original package and release tags.
Published SDK bundles support automatic matching Runner downloads; the renamed
SDK requires newly built, signed, notarized, and released Spark assets.

## Moving from Frame

This is a breaking rename. Regenerate native projects and rebuild Runner; existing
Frame binaries are incompatible with Spark. There are no compatibility package
aliases and application data is not migrated automatically.

| Previous | Current |
| --- | --- |
| Legend Frame / `frame` | Legend Spark / `spark` |
| `@legendapp/frame/<feature>` | `@legendapp/spark/<feature>` |
| `.frame/`, `~/.frame/` | `.spark/`, `~/.spark/` |
| `FRAME_*` environment variables | `SPARK_*` |
| `frame` package metadata / Expo extras | `spark` |
| `withFrameExpo` | `withSparkExpo` |
| `FrameRunner.app` | `SparkRunner.app` |
| `frame-runtime.json` | `spark-runtime.json` |

`desktop.config.json`, window geometry (`Frame`, `frame`, `setWindowFrame`), and
camera frame APIs retain their names. Old `.frame` and `.legend` directories stay
ignored and are not deleted or moved. Preserve prototype data and credentials
before changing namespaces.

Replace direct implementation dependencies with the single public SDK. Update
imports, scripts, config wrappers, Expo extras, and environment settings together.
The generated postinstall command is
`node node_modules/@legendapp/spark/init-template.cjs`. Native module inclusion and
exclusion lists use private implementation identities; these are not public
JavaScript import paths. Repack SDK bundles rather than mixing Frame and Spark
archives, and reapply application-specific configuration to a fresh starter.

For Kitchen Sink, install at the repository root, then:

```sh
cd examples/kitchen-sink
npm run rebuild:macos  # or rebuild:windows, on Windows
npm run macos         # or windows
```

Starter icon artwork lives in `assets/branding/legend-spark.png` and is copied
into each starter's `assets/icon.png`.

Follow the [manual acceptance checklist](desktop-manual-acceptance.md) after
rebuilding. The [previous Frame validation report](frame-rename-validation.md)
is historical and does not establish native acceptance for Spark.
