// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dropPushEntitlement } = require('../plugins/withoutPushEntitlement');

describe('dropPushEntitlement', () => {
  it('removes the push capability expo-notifications adds, which a free Apple ID cannot sign', () => {
    expect(dropPushEntitlement({ 'aps-environment': 'development', 'com.apple.developer.associated-domains': ['x'] })).toEqual({
      'com.apple.developer.associated-domains': ['x'],
    });
  });

  it('leaves entitlements without it alone', () => {
    expect(dropPushEntitlement({})).toEqual({});
  });
});
