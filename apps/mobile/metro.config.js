const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Treat .svg files as React components via react-native-svg-transformer so
// we can `import Icon from "./logo.svg"` and render it like any RN component.
const { transformer, resolver } = config;
config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve("react-native-svg-transformer/expo"),
};
config.resolver = {
  ...resolver,
  assetExts: resolver.assetExts.filter((ext) => ext !== "svg"),
  sourceExts: [...resolver.sourceExts, "svg"],
};

// Watch monorepo root for changes
config.watchFolders = [monorepoRoot];

// Let Metro find modules in both locations
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Force React to resolve from monorepo root
config.resolver.extraNodeModules = {
  react: path.resolve(monorepoRoot, "node_modules/react"),
};

module.exports = withNativeWind(config, { input: "./global.css" });
