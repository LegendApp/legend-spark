# Application configuration

`@legendapp/spark/config` exports `SparkConfig`, `SparkApplicationConfig`,
`SparkExpoProjectConfig`, `WindowConfiguration`, platform and capability options,
and typed readers. `toExpo` accepts untrusted JSON and validates Spark-owned settings;
its result has a required name, version, slug and `extra.spark`. General readers
also accept Expo configuration, so their optional fields must be checked before use.

## Spark-owned projects

Author `desktop.config.json`. The CLI prepares Expo's transport configuration from
this file; generated `app.json` is not a second source of truth. Multi-target
projects use the generated `app.config.js` resolver.

```json
{
  "projectId": "keep-the-generated-project-id",
  "name": "Editor",
  "version": "1.0.0",
  "platforms": ["macos"],
  "macos": { "bundleIdentifier": "com.example.editor" },
  "window": {
    "size": { "width": 1000, "height": 700 },
    "minSize": { "width": 500, "height": 300 },
    "restoreBounds": true
  }
}
```

`size`, `minSize` and `maxSize` use outer-frame logical dimensions, just like
runtime windows. Each size supplies width and height. Null min/max constraints use
the supported default range. Restoration constrains saved dimensions to current
limits. AppKit content background materials are explicitly
`window.macos.backgroundMaterial`; traffic lights are
`window.macos.titleBar.trafficLights`. Private flat native transport fields are not
accepted in public configuration.

Spark owns project identity, initial window settings, document associations,
update signing, helper bundles and desktop lifecycle policy. Expo owns its plugins
and mobile/web settings: put those under `expo`, or `expoByPlatform.<target>`.
Those objects retain Expo's model rather than a renamed Spark facade.

## Existing Expo projects

Keep Expo's configuration as the source of application name/version and compose it
with `withSparkExpo` from `@legendapp/spark/expo-config`. The desktop sidecar declares
`extends: "expo"`, project identity and supported platforms. It adds Spark's desktop
settings only in the selected desktop or shared development session. See
[adding desktop](add-desktop.md) for the complete setup recipe.

The JSON schema in `/schema.json` checks editor-visible structure. Runtime validation
also checks relationships such as size constraints, selected targets, helper paths
and update feed/key requirements. Tests reconcile schema keys with public types and
verify the native window transport independently.
