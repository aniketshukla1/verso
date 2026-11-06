/**
 * Point a debug build at Metro by the Mac's Bonjour name, not its IP address.
 *
 * On a physical device, React Native finds Metro through ip.txt, which its
 * "Bundle React Native code and images" phase fills with the Mac's current IP.
 * That IP moves with the network: on 2026-09-22 one build baked in the iPhone
 * hotspot address, the Mac rejoined home Wi-Fi an hour later, and the installed
 * app could no longer load at all until rebuilt.
 *
 * The Bonjour name (<LocalHostName>.local) is the same on every network,
 * and over the USB link; the API client already relies on it
 * (src/api/client.ts, EXPO_PUBLIC_DEV_HOSTNAME). This appends a few lines to
 * ios/.xcode.env, which that phase sources first: they write the name into
 * ip.txt and set SKIP_BUNDLING_METRO_IP, React Native's own switch for leaving
 * ip.txt alone.
 *
 * A config plugin rather than a hand edit because `expo prebuild` regenerates
 * ios/ and would discard anything done by hand.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const MARK = '# verso: find Metro by the Mac\'s Bonjour name (plugins/withMetroBonjourHost.js)';
const SNIPPET = `
${MARK}
if [[ "$CONFIGURATION" = *Debug* && "$PLATFORM_NAME" != *simulator \\
      && -n "$CONFIGURATION_BUILD_DIR" && -n "$UNLOCALIZED_RESOURCES_FOLDER_PATH" ]]; then
  export SKIP_BUNDLING_METRO_IP=1
  mkdir -p "$CONFIGURATION_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
  echo "$(scutil --get LocalHostName).local" > "$CONFIGURATION_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/ip.txt"
fi
`;

module.exports = function withMetroBonjourHost(config) {
  return withDangerousMod(config, ['ios', async cfg => {
    const file = path.join(cfg.modRequest.platformProjectRoot, '.xcode.env');
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!current.includes(MARK)) fs.writeFileSync(file, current + SNIPPET);
    return cfg;
  }]);
};

module.exports.SNIPPET = SNIPPET;
module.exports.MARK = MARK;
