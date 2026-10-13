#!/bin/sh
# Builds the Kitchen Sink's privileged helper into build/privileged-helper for a build that opts in to it
# (e2e/flows/processes-ipc/privileged-helper-real.yaml). spark package signs it with the app's team.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
helper="$(cd "$here" && node -p 'require("path").dirname(require.resolve("@legendapp/spark-privileged-helper/package.json"))')/helper"
mkdir -p "$here/build"
clang -fobjc-arc -O2 -mmacosx-version-min=14.0 -I "$helper" -framework Foundation -framework Security \
  "$here/main.m" "$helper/SparkPrivilegedHelperService.m" -o "$here/build/privileged-helper"
echo "Built $here/build/privileged-helper"
