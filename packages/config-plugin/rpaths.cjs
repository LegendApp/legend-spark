const marker = "# spark: remove Swift toolchain runpath";
const toolchain = '"${TOOLCHAIN_DIR}/usr/lib/swift/${PLATFORM_NAME}"';

function stripSwiftToolchainRunpath(podfile) {
  if (podfile.includes(marker)) return podfile;
  const postInstall = /^[ \t]*post_install do \|installer\|[ \t]*$/m;
  if (!postInstall.test(podfile)) throw new Error("Missing post_install block for Spark's macOS runpath configuration.");
  return podfile.replace(postInstall, line => `${line}
    ${marker}
    installer.aggregate_targets.each do |aggregate|
      aggregate.xcconfigs.each do |configuration, xcconfig|
        paths = xcconfig.attributes['LD_RUNPATH_SEARCH_PATHS']
        next unless paths&.include?('${toolchain}')
        xcconfig.attributes['LD_RUNPATH_SEARCH_PATHS'] = paths.gsub('${toolchain}', '')
        xcconfig.save_as(aggregate.xcconfig_path(configuration))
      end
    end`);
}

module.exports = { stripSwiftToolchainRunpath };
