const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const WATCH_APP_TARGET = "PostHogCodeWatch";
const WATCH_EXTENSION_TARGET = "PostHogCodeWatchExtension";
const WATCH_SOURCE_DIR = "watch";
const WATCH_BUNDLE_ID = "com.posthog.code.mobile.watchkitapp";
const WATCH_EXTENSION_BUNDLE_ID = `${WATCH_BUNDLE_ID}.watchkitextension`;

function copyNativeFiles(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Missing native source directory: ${sourceDir}`);
  }

  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir)) {
    const source = path.join(sourceDir, entry);
    const destination = path.join(destinationDir, entry);
    if (fs.statSync(source).isFile()) {
      fs.copyFileSync(source, destination);
    }
  }
}

function ensureWatchScaffold(iosRoot) {
  const mobileRoot = path.resolve(__dirname, "..");
  const nativeRoot = path.join(mobileRoot, "native");

  copyNativeFiles(
    path.join(nativeRoot, "watch"),
    path.join(iosRoot, WATCH_SOURCE_DIR),
  );
  copyNativeFiles(
    path.join(nativeRoot, "ios"),
    path.join(iosRoot, "PostHogCode"),
  );
}

function quote(value) {
  return `"${value}"`;
}

function ensureBuildPhases(project, targetUuid) {
  const target = project.hash.project.objects.PBXNativeTarget[targetUuid];
  const phaseNames = new Set(
    (target.buildPhases ?? []).map((phase) => phase.comment),
  );
  if (!phaseNames.has("Sources")) {
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", targetUuid);
  }
  if (!phaseNames.has("Frameworks")) {
    project.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      targetUuid,
    );
  }
  if (!phaseNames.has("Resources")) {
    project.addBuildPhase(
      [],
      "PBXResourcesBuildPhase",
      "Resources",
      targetUuid,
    );
  }
}

function targetUuid(project, targetName) {
  const targets = project.hash.project.objects.PBXNativeTarget;
  for (const [key, target] of Object.entries(targets)) {
    if (key.endsWith("_comment")) continue;
    const normalizedName = String(target.name ?? "").replace(/^"|"$/g, "");
    const normalizedProductName = String(target.productName ?? "").replace(
      /^"|"$/g,
      "",
    );
    if (normalizedName === targetName || normalizedProductName === targetName) {
      return key;
    }
  }
  return undefined;
}

function hasTarget(project, targetName) {
  return !!targetUuid(project, targetName);
}

function ensureDependencySections(project) {
  const objects = project.hash.project.objects;
  objects.PBXContainerItemProxy ??= {};
  objects.PBXTargetDependency ??= {};
}

function hasTargetDependency(project, target, dependencyTarget) {
  const nativeTarget = project.hash.project.objects.PBXNativeTarget[target];
  const dependencies = nativeTarget?.dependencies ?? [];
  const targetDependencies =
    project.hash.project.objects.PBXTargetDependency ?? {};

  return dependencies.some((dependency) => {
    const targetDependency = targetDependencies[dependency.value];
    return targetDependency?.target === dependencyTarget;
  });
}

function ensureTargetDependency(project, target, dependencyTarget) {
  ensureDependencySections(project);
  if (!hasTargetDependency(project, target, dependencyTarget)) {
    project.addTargetDependency(target, [dependencyTarget]);
  }
}

function groupKeyByName(project, groupName) {
  const groups = project.hash.project.objects.PBXGroup;
  for (const [key, value] of Object.entries(groups)) {
    if (key.endsWith("_comment")) continue;
    if (groups[`${key}_comment`] === groupName || value.name === groupName) {
      return key;
    }
  }
  return undefined;
}

function ensureSource(project, filePath, target, groupName = WATCH_SOURCE_DIR) {
  const existing = project.hasFile(filePath);
  if (existing) return;
  project.addSourceFile(
    filePath,
    { target },
    groupKeyByName(project, groupName),
  );
}

function ensureWatchSource(project, fileName, target) {
  const watchGroupKey = groupKeyByName(project, WATCH_SOURCE_DIR);
  project.removeSourceFile(
    `${WATCH_SOURCE_DIR}/${fileName}`,
    { target },
    watchGroupKey,
  );
  ensureSource(project, fileName, target, WATCH_SOURCE_DIR);
}

function updateTargetBuildSettings(project, targetUuid, settings) {
  const target = project.hash.project.objects.PBXNativeTarget[targetUuid];
  const configListId = target?.buildConfigurationList;
  const configList =
    project.hash.project.objects.XCConfigurationList[configListId];
  if (!configList?.buildConfigurations) return;

  for (const item of configList.buildConfigurations) {
    const config =
      project.hash.project.objects.XCBuildConfiguration[item.value];
    if (!config?.buildSettings) continue;
    Object.assign(config.buildSettings, settings);
  }
}

function addWatchTargets(project) {
  if (!project.pbxGroupByName(WATCH_SOURCE_DIR)) {
    const group = project.addPbxGroup([], WATCH_SOURCE_DIR, WATCH_SOURCE_DIR);
    const mainGroupId = project.getFirstProject().firstProject.mainGroup;
    const mainGroup = project.hash.project.objects.PBXGroup[mainGroupId];
    mainGroup.children.push({ value: group.uuid, comment: WATCH_SOURCE_DIR });
  }

  const watchApp = hasTarget(project, WATCH_APP_TARGET)
    ? { uuid: targetUuid(project, WATCH_APP_TARGET) }
    : project.addTarget(
        WATCH_APP_TARGET,
        "watch2_app",
        WATCH_SOURCE_DIR,
        WATCH_BUNDLE_ID,
      );
  const watchExtension = hasTarget(project, WATCH_EXTENSION_TARGET)
    ? { uuid: targetUuid(project, WATCH_EXTENSION_TARGET) }
    : project.addTarget(
        WATCH_EXTENSION_TARGET,
        "watch2_extension",
        WATCH_SOURCE_DIR,
        WATCH_EXTENSION_BUNDLE_ID,
      );

  ensureBuildPhases(project, watchApp.uuid);
  ensureBuildPhases(project, watchExtension.uuid);

  const hostTargetUuid = project.getFirstTarget().uuid;
  ensureTargetDependency(project, hostTargetUuid, watchApp.uuid);
  ensureTargetDependency(project, watchApp.uuid, watchExtension.uuid);

  ensureSource(
    project,
    "PostHogCode/WatchMissionControlModule.swift",
    hostTargetUuid,
    "PostHogCode",
  );
  ensureSource(
    project,
    "PostHogCode/WatchMissionControlModule.m",
    hostTargetUuid,
    "PostHogCode",
  );

  ensureWatchSource(project, "PostHogCodeWatchApp.swift", watchExtension.uuid);
  ensureWatchSource(project, "WatchMissionStore.swift", watchExtension.uuid);
  ensureWatchSource(project, "WatchMissionModels.swift", watchExtension.uuid);
  ensureWatchSource(project, "MissionViews.swift", watchExtension.uuid);
  ensureWatchSource(project, "HapticsPolicy.swift", watchExtension.uuid);

  updateTargetBuildSettings(project, watchApp.uuid, {
    ASSETCATALOG_COMPILER_APPICON_NAME: "AppIcon",
    CODE_SIGN_ENTITLEMENTS: `${WATCH_SOURCE_DIR}/PostHogCodeWatch.entitlements`,
    CURRENT_PROJECT_VERSION: "1",
    INFOPLIST_FILE: `${WATCH_SOURCE_DIR}/Info.plist`,
    LD_RUNPATH_SEARCH_PATHS: quote("$(inherited) @executable_path/Frameworks"),
    MARKETING_VERSION: "1.0",
    PRODUCT_BUNDLE_IDENTIFIER: WATCH_BUNDLE_ID,
    PRODUCT_NAME: WATCH_APP_TARGET,
    SDKROOT: "watchos",
    SKIP_INSTALL: "YES",
    SWIFT_VERSION: "5.0",
    TARGETED_DEVICE_FAMILY: "4",
    WATCHOS_DEPLOYMENT_TARGET: "10.0",
  });

  updateTargetBuildSettings(project, watchExtension.uuid, {
    CODE_SIGN_ENTITLEMENTS: `${WATCH_SOURCE_DIR}/PostHogCodeWatchExtension.entitlements`,
    CURRENT_PROJECT_VERSION: "1",
    INFOPLIST_FILE: `${WATCH_SOURCE_DIR}/ExtensionInfo.plist`,
    LD_RUNPATH_SEARCH_PATHS: quote("$(inherited) @executable_path/Frameworks"),
    MARKETING_VERSION: "1.0",
    PRODUCT_BUNDLE_IDENTIFIER: WATCH_EXTENSION_BUNDLE_ID,
    PRODUCT_NAME: WATCH_EXTENSION_TARGET,
    SDKROOT: "watchos",
    SKIP_INSTALL: "YES",
    SWIFT_VERSION: "5.0",
    TARGETED_DEVICE_FAMILY: "4",
    WATCHOS_DEPLOYMENT_TARGET: "10.0",
  });

  return project;
}

module.exports = function withWatchApp(config) {
  config = withDangerousMod(config, [
    "ios",
    (config) => {
      ensureWatchScaffold(config.modRequest.platformProjectRoot);
      return config;
    },
  ]);

  return withXcodeProject(config, (config) => {
    config.modResults = addWatchTargets(config.modResults);
    return config;
  });
};
