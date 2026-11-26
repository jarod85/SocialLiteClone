import { fixture } from './fixtures';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { adoptSceneLifecycle } = require('../plugins/withSceneLifecycle');

const TEMPLATE = fixture('ios/AppDelegate.expo57.swift');

describe('adoptSceneLifecycle', () => {
  it('makes the app delegate a factory provider that no longer starts React Native itself', () => {
    const out: string = adoptSceneLifecycle(TEMPLATE);
    expect(out).toContain('class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    expect(out).not.toContain('factory.startReactNative(');
    expect(out).not.toContain('UIWindow(frame: UIScreen.main.bounds)');
    expect(out).toContain('reactNativeFactory = factory');
  });

  it('leaves an already converted app delegate alone', () => {
    const once: string = adoptSceneLifecycle(TEMPLATE);
    expect(adoptSceneLifecycle(once)).toBe(once);
  });

  it('fails loudly when the template changes', () => {
    expect(() => adoptSceneLifecycle('class Other {}')).toThrow(/no longer looks like/);
  });
});
