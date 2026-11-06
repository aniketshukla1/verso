// Expo + pnpm workspace. Without this Metro walks up to the repo root, treats
// it as the project root, and fails to resolve ./index.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// watch the workspace so shared packages hot-reload
config.watchFolders = [workspaceRoot];

// pnpm's store is not hoisted; look in both places and stop Metro guessing
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
