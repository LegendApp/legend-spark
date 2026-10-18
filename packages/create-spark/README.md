# Create Spark

Create a Legend Spark app with the CLI and native desktop APIs from `@legendapp/spark`.
Requires Node 24.19.0 or newer on macOS 14+ with Apple Silicon.

```sh
npm create @legendapp/spark@next MyApp
cd MyApp
npm run macos
```

The app opens in Spark Runner, downloaded from the matching GitHub release.
Bun is optional. Select another installed package manager with
`-- --package-manager bun|pnpm|yarn`. Native builds require Xcode and CocoaPods.

Spark is experimental. Windows is a preview without a downloadable Runner.
See the [documentation](https://legend.so/spark) and
[source](https://github.com/LegendApp/legend-spark).
