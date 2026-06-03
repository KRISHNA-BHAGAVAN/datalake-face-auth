const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add ML models to the list of assets to bundle
config.resolver.assetExts.push('tflite', 'task', 'onnx', 'bin');

module.exports = config;
