/**
 * Turn off Xcode's user-script sandbox for the app target.
 *
 * Xcode 27 enforces ENABLE_USER_SCRIPT_SANDBOXING strictly: a Run Script phase
 * may only write the files it declares as outputs. Two phases in this target
 * write into the built .app without declaring anything:
 *
 *   - React Native's "Bundle React Native code and images" writes ip.txt, the
 *     Mac's address, which a debug build uses to find Metro
 *   - "Sign embedded frameworks (Verso)" re-signs frameworks in place
 *     (see withSignEmbeddedFrameworks.js)
 *
 * so the first Xcode 27 build failed with
 *
 *   Sandbox: bash deny(1) file-write-data .../Verso.app/ip.txt
 *
 * The generated project sets the flag to YES and Xcode 26 did not enforce it.
 * This sets NO on the app target's configurations only; CocoaPods already
 * turns it off for the Pods targets.
 *
 * A config plugin rather than an Xcode edit because `expo prebuild` regenerates
 * ios/ and would discard anything done by hand.
 */
const { withXcodeProject } = require('@expo/config-plugins');

module.exports = function withUserScriptSandboxingOff(config) {
  return withXcodeProject(config, cfg => {
    const project = cfg.modResults;
    const lists = project.pbxXCConfigurationList();
    const configs = project.pbxXCBuildConfigurationSection();
    const targets = project.pbxNativeTargetSection();

    for (const [id, target] of Object.entries(targets)) {
      if (id.endsWith('_comment') || typeof target !== 'object') continue;
      if (!String(target.productType).includes('com.apple.product-type.application')) continue;
      const list = lists[target.buildConfigurationList];
      for (const { value } of list?.buildConfigurations ?? []) {
        if (configs[value]?.buildSettings) {
          configs[value].buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
        }
      }
    }
    return cfg;
  });
};
