// Metro for a STANDALONE Expo app inside the monorepo. It watches the repo root so it can resolve
// `@studio/core/client` (the shared wire contract) straight from source, and it resolves modules from
// the app's own node_modules first. `@studio/core/client` is a path alias, not a workspace dependency.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [projectRoot, path.resolve(workspaceRoot, 'packages/core/src')]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]
config.resolver.extraNodeModules = {
  '@studio/core/client': path.resolve(workspaceRoot, 'packages/core/src/client.ts'),
}
config.resolver.disableHierarchicalLookup = true

module.exports = config
