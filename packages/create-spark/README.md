# Create Spark

Create a Legend Spark app with the CLI and native desktop APIs from `@legendapp/spark`.
Requires Node 24.19.0 or newer on macOS 14+ with Apple Silicon.

```sh
npm create @legendapp/spark@next MyApp
cd MyApp
npm run macos
```

Choose a channel explicitly with any supported package manager:

| Manager | Next preview | Latest |
| --- | --- | --- |
| npm | `npm create @legendapp/spark@next MyApp -- --next` | `npm create @legendapp/spark@latest MyApp -- --latest` |
| Bun | `bun create @legendapp/spark@next MyApp --next` | `bun create @legendapp/spark@latest MyApp --latest` |
| pnpm | `pnpm create @legendapp/spark MyApp --next` | `pnpm create @legendapp/spark MyApp --latest` |
| Yarn (including Yarn 1) | `yarn create @legendapp/spark MyApp --next` | `yarn create @legendapp/spark MyApp --latest` |

pnpm can drop the creator tag, and Yarn 1 cannot take a tag in `yarn create`.
The self-contained creator resolves explicit channel flags through npm dist-tags.
It pins the SDK to its bundled release metadata. If the selected version differs,
it prints an exact `npx @legendapp/create-spark@<version>` command to run; version
selection downloads no SDK. `--spark-version <version|tag>` selects another release;
use only one selection flag. With no flag, the creator uses its own release.
These commands require the matching creator and release assets to be published.

The app opens in Spark Runner, downloaded from the matching GitHub release.
Bun is optional. Select another installed package manager with
`-- --package-manager bun|pnpm|yarn` with npm, or
`--package-manager npm|bun|pnpm|yarn` with other managers. Native builds require Xcode and CocoaPods.

Spark is experimental. Windows is a preview without a downloadable Runner.
See the [documentation](https://legend.so/spark) and
[source](https://github.com/LegendApp/legend-spark).
