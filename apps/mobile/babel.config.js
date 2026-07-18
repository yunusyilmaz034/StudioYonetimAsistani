module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // Reanimated's Babel plugin MUST be last (owner: Reanimated is part of the stack).
    plugins: ['react-native-reanimated/plugin'],
  }
}
