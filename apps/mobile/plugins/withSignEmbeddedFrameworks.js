/**
 * Sign embedded frameworks that arrive unsigned.
 *
 * Expo and React Native ship several modules as PREBUILT XCFrameworks (React,
 * ReactNativeDependencies, ExpoModulesCore, ExpoModulesJSI, ExpoModulesWorklets,
 * ExpoFileSystem, ZXingObjC). Their "[Expo] Switch <X> XCFramework for build
 * configuration" script phases swap the binary in AFTER CocoaPods' embed-and-sign
 * step, so those frameworks land in the .app with no signature and iOS refuses
 * the install:
 *
 *   Failed to verify code signature of .../Frameworks/ExpoFileSystem.framework
 *   0xe800801c (No code signature found.)  ->  ApplicationVerificationFailed
 *
 * Building everything from source (EXPO_USE_SOURCE=1, RCT_USE_PREBUILT_RNCORE=0)
 * also fixes it, but costs 20-40 minutes of React Native compilation on every
 * clean build. Signing the stragglers keeps the prebuilt binaries and their fast
 * builds.
 *
 * This runs as the LAST phase of the app target, after everything is embedded.
 * It only touches frameworks that fail verification, so correctly signed ones
 * are left exactly as Xcode signed them.
 *
 * Lives as a config plugin rather than an Xcode edit because `expo prebuild`
 * regenerates ios/ and would discard anything done by hand.
 */
const { withXcodeProject } = require('@expo/config-plugins');

const PHASE_NAME = 'Sign embedded frameworks (Verso)';

const SHELL_SCRIPT = [
  'set -euo pipefail',
  '',
  '# Simulator builds and unsigned configurations have nothing to do.',
  'if [ "${CODE_SIGNING_ALLOWED:-NO}" != "YES" ]; then exit 0; fi',
  'if [ -z "${EXPANDED_CODE_SIGN_IDENTITY:-}" ]; then exit 0; fi',
  '',
  'FRAMEWORKS="${CODESIGNING_FOLDER_PATH}/Frameworks"',
  '[ -d "$FRAMEWORKS" ] || exit 0',
  '',
  'signed=0',
  'for fw in "$FRAMEWORKS"/*.framework; do',
  '  [ -d "$fw" ] || continue',
  '  if ! /usr/bin/codesign --verify "$fw" >/dev/null 2>&1; then',
  '    echo "note: re-signing unsigned framework $(basename "$fw")"',
  '    /usr/bin/codesign --force --sign "${EXPANDED_CODE_SIGN_IDENTITY}" --timestamp=none --preserve-metadata=identifier,flags "$fw"',
  '    signed=$((signed + 1))',
  '  fi',
  'done',
  'echo "note: signed $signed previously-unsigned framework(s)"',
].join('\n');

module.exports = function withSignEmbeddedFrameworks(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;

    // Idempotent: prebuild may run repeatedly against the same project.
    const existing = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    const already = Object.values(existing).some(
      (p) => p && typeof p === 'object' && p.name && p.name.includes(PHASE_NAME),
    );
    if (already) return cfg;

    // The `xcode` library escapes double quotes for us but NOT newlines, and a
    // literal newline inside the quoted pbxproj string makes CocoaPods fail with
    // "Unterminated quoted string". Escaping quotes here too would double-escape
    // them (\\" instead of \"), which breaks the script a different way.
    project.addBuildPhase([], 'PBXShellScriptBuildPhase', PHASE_NAME, null, {
      shellPath: '/bin/sh',
      shellScript: SHELL_SCRIPT.replace(/\n/g, '\\n'),
    });

    return cfg;
  });
};
