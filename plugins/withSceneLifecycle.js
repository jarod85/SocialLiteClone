/**
 * iOS 27 refuses to launch apps without the UIScene life cycle ("UIScene life cycle is required for apps
 * built with this SDK"). Expo SDK 57 ships the scene delegate (ExpoAppSceneDelegate) but its app template
 * still starts React Native in the app delegate. This plugin switches the generated app over: Info.plist
 * names Expo's scene delegate, and the app delegate only creates the React Native factory, which the scene
 * delegate starts in the scene's window. Remove it once Expo's own template does this.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
    ],
  },
};

const CLASS_LINE = 'class AppDelegate: ExpoAppDelegate {';
const START_BLOCK = /#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*factory\.startReactNative\([^)]*\)\s*#endif\n/;

/** The template's AppDelegate.swift, changed to hand the window to the scene delegate. */
function adoptSceneLifecycle(source) {
  if (source.includes('ExpoReactNativeFactoryProvider')) return source;
  if (!source.includes(CLASS_LINE) || !START_BLOCK.test(source)) {
    throw new Error('withSceneLifecycle: AppDelegate.swift no longer looks like Expo 57\'s template; update the plugin.');
  }
  return source
    .replace(CLASS_LINE, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
    .replace(START_BLOCK, '// The scene delegate (EXExpoAppSceneDelegate, see Info.plist) creates the window and starts React Native.\n');
}

function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    return cfg;
  });
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') throw new Error('withSceneLifecycle: expected a Swift AppDelegate.');
    cfg.modResults.contents = adoptSceneLifecycle(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withSceneLifecycle;
module.exports.adoptSceneLifecycle = adoptSceneLifecycle;
