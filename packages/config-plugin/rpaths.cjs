// CocoaPods puts "${TOOLCHAIN_DIR}/usr/lib/swift/${PLATFORM_NAME}" in the app's LD_RUNPATH_SEARCH_PATHS. Linked in, it is
// an absolute LC_RPATH into the build machine's Xcode toolchain: outside the bundle and outside System Integrity
// Protection, so a library planted there could load (assertLoadPaths, docs/e2e-flows.md#security-audits). The Swift
// runtime of the supported macOS versions is in /usr/lib/swift, which stays.
const MARKER = "# spark: no toolchain rpaths";
const HOOK = `    ${MARKER}
    installer.aggregate_targets.each do |aggregate|
      aggregate.xcconfigs.each do |configuration, xcconfig|
        paths = xcconfig.attributes['LD_RUNPATH_SEARCH_PATHS']
        next unless paths&.include?('TOOLCHAIN_DIR')
        xcconfig.attributes['LD_RUNPATH_SEARCH_PATHS'] = paths.split(' ').reject { |path| path.include?('TOOLCHAIN_DIR') }.join(' ')
        xcconfig.save_as(aggregate.xcconfig_path(configuration))
      end
    end
`;

/** The Podfile with the hook that drops toolchain run paths, right after react_native_post_install. */
function toolchainRpathsPodfile(contents) {
  if (contents.includes(MARKER)) return contents;
  const call = /^[ \t]*react_native_post_install\(installer\b[^\n]*\n/m;
  if (!call.test(contents)) throw new Error("The Podfile has no react_native_post_install(installer, …) call for Spark's run path hook.");
  return contents.replace(call, line => `${line}\n${HOOK}`);
}

module.exports = { toolchainRpathsPodfile };
