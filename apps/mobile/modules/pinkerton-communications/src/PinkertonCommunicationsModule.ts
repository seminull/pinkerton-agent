import { NativeModule, requireOptionalNativeModule } from 'expo';
import type { PinkertonCommunicationsNativeModule } from './PinkertonCommunications.types';

type NativeCommunicationsModule = NativeModule<Record<never, never>> &
  PinkertonCommunicationsNativeModule;

// Expo Go does not contain this local Kotlin module. Optional lookup lets the
// contact-selection UI remain useful there while making the sync boundary
// explicit instead of crashing at import time.
export default requireOptionalNativeModule<NativeCommunicationsModule>(
  'PinkertonCommunications'
);
