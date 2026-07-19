module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 extracted its worklets runtime into `react-native-worklets`; the Babel plugin moved
    // there too and MUST be last.
    plugins: ['react-native-worklets/plugin'],
  }
}
