/**
 * Expo config plugin: keep CMake object-file paths under Windows' 260-character limit.
 *
 * React Native compiles library codegen sources that live outside the CMake
 * source tree, and CMake mirrors their absolute path into the object-file path
 * (…/react_codegen_x.dir/C_/Users/…/node_modules/…/File.cpp.o). On Windows that
 * easily passes 300 characters, and the ninja bundled with the Android SDK's CMake
 * can't open such paths ("Filename longer than 260 characters").
 *
 * CMake can shorten over-long object names by replacing their directory part with
 * a hash, but it only does that when CMAKE_OBJECT_PATH_MAX is set, which its
 * Android platform files don't do. This sets it for the app's native build.
 * Elsewhere it's harmless: only names that would exceed the limit change.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = 'CMAKE_OBJECT_PATH_MAX';

module.exports = function withCMakeObjectPathMax(config, { max = 250 } = {}) {
  return withAppBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;
    if (!/defaultConfig\s*\{/.test(gradle)) {
      throw new Error('withCMakeObjectPathMax: no defaultConfig block found in app/build.gradle');
    }
    cfg.modResults.contents = gradle.replace(
      /defaultConfig\s*\{/,
      (match) => `${match}
        // Added by plugins/withCMakeObjectPathMax.js (Windows path-length limit).
        externalNativeBuild { cmake { arguments "-D${MARKER}=${max}" } }`,
    );
    return cfg;
  });
};
