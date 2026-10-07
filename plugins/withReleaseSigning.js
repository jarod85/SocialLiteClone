/**
 * Expo config plugin: sign release builds with your own private key.
 *
 * Expo's template signs release builds with the public debug key, which anyone
 * can use to sign an APK your phone would accept as an update. With this
 * plugin, release builds use the keystore described by a properties file whose
 * path is in the LITESOCIAL_SIGNING environment variable (storeFile,
 * storePassword, keyAlias, keyPassword). scripts/build-android.ps1 sets it;
 * the file and keystore live outside the repository and are never committed.
 *
 * Without LITESOCIAL_SIGNING, release builds fall back to the debug key, as
 * before (the build script refuses that unless asked to).
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = 'liteSocialSigning';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    const load = `
// Added by plugins/withReleaseSigning.js: the private release key, described by the
// properties file named in LITESOCIAL_SIGNING (kept outside the repository).
def liteSocialSigning = new Properties()
def liteSocialSigningPath = System.getenv('LITESOCIAL_SIGNING')
if (liteSocialSigningPath && new File(liteSocialSigningPath).exists()) {
    new File(liteSocialSigningPath).withInputStream { liteSocialSigning.load(it) }
}
`;
    if (!/\nandroid\s*\{/.test(gradle)) throw new Error('withReleaseSigning: no android block in app/build.gradle');
    gradle = gradle.replace(/\nandroid\s*\{/, (match) => `\n${load}${match}`);

    if (!/signingConfigs\s*\{/.test(gradle)) throw new Error('withReleaseSigning: no signingConfigs block');
    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      (match) => `${match}
        release {
            if (liteSocialSigning.storeFile) {
                storeFile file(liteSocialSigning.storeFile)
                storePassword liteSocialSigning.storePassword
                keyAlias liteSocialSigning.keyAlias
                keyPassword liteSocialSigning.keyPassword
            }
        }`,
    );

    const releaseSigning = /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/;
    if (!releaseSigning.test(gradle)) throw new Error('withReleaseSigning: release build type not found');
    gradle = gradle.replace(
      releaseSigning,
      '$1signingConfig liteSocialSigning.storeFile ? signingConfigs.release : signingConfigs.debug',
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
