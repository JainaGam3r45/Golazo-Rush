import { insforge, isInsForgeConfigured } from '../insforge';

export function canUseInsForge(): boolean {
  return isInsForgeConfigured && insforge !== null;
}

export function shouldUseMockData(): boolean {
  return !canUseInsForge();
}

export function getInsForgeClient() {
  return insforge;
}
