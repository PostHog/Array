// `expo.name` drives BOTH the native Xcode scheme/product name and the
// user-facing app label on each platform -- Expo has no per-platform `name`
// override (only `web.name` exists).
//
// `expo.name` must therefore stay distinct from the "PostHog" CocoaPod that
// posthog-react-native-session-replay pulls in: when the scheme is also named
// "PostHog", xcodebuild archives fine but cannot enumerate distribution
// methods, and the .ipa export dies with "Unknown Distribution Error".
//
// So `expo.name` is "PostHog Code" and the user-facing label is pinned back to
// "PostHog" per platform -- here for Android, and via
// `ios.infoPlist.CFBundleDisplayName` for iOS.

const { withStringsXml, AndroidConfig } = require("@expo/config-plugins");

const DEFAULT_APP_NAME = "PostHog";

const withAndroidAppName = (config, { appName = DEFAULT_APP_NAME } = {}) =>
  withStringsXml(config, (cfg) => {
    cfg.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: "app_name", translatable: "false" }, _: appName }],
      cfg.modResults,
    );
    return cfg;
  });

module.exports = withAndroidAppName;
