# Legend Spark

**Experimental — not ready for production use.** APIs, native implementations, and tooling may change.

Legend Spark adds native desktop APIs and a managed development workflow to React Native and Expo Desktop. Application JavaScript runs in Hermes; Node is not embedded.

## Try the experimental release

Requires Node 24.19.0 or newer. The single `@legendapp/spark` npm package contains the CLI and private implementation modules; no separate Spark module installs are needed. Bun is optional.

```sh
npx @legendapp/spark@next create MyApp
cd MyApp
npm run macos
```

The published CLI uses matching GitHub release assets for patched native dependencies and automatically downloads the macOS ARM64 Spark Runner on first desktop launch. JavaScript edits use Fast Refresh. Native changes require a compatible runtime rebuild and native build tools.

Source/local archives without embedded release metadata require a registered local SDK; see the repository setup guide.

macOS 14+ on Apple Silicon is the primary experimental target. Windows development implementations still need native acceptance; Windows production builds and a downloadable Windows Runner are not supplied by this prerelease workflow. Mobile and web use Expo workflows with selected shared adapters.

[Documentation](https://legend.so/spark) · [Source and setup guide](https://github.com/LegendApp/legend-spark) · [Known Windows limitations](https://github.com/LegendApp/legend-spark/blob/main/docs/windows-issues.md)
