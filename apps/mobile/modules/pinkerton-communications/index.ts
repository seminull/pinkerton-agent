// Re-export the native module. On web, it will be resolved to PinkertonCommunicationsModule.web.ts
// and on native platforms to PinkertonCommunicationsModule.ts
export { default } from './src/PinkertonCommunicationsModule';
export * from './src/PinkertonCommunications.types';
