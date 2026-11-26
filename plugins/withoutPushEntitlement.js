/**
 * expo-notifications' plugin gives the iOS app the Push Notifications capability (aps-environment).
 * Lite Social only posts local notifications, which need no capability, and a free Apple ID can't
 * sign an app that has it. List this plugin before expo-notifications in app.json: a plugin listed
 * earlier edits the entitlements after the ones listed later.
 */
const { withEntitlementsPlist } = require('expo/config-plugins');

function dropPushEntitlement(entitlements) {
  const { 'aps-environment': _push, ...rest } = entitlements;
  return rest;
}

function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    cfg.modResults = dropPushEntitlement(cfg.modResults);
    return cfg;
  });
}

module.exports = withoutPushEntitlement;
module.exports.dropPushEntitlement = dropPushEntitlement;
