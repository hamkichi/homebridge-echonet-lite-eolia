/**
 * Utility functions for EchoNet-Lite Aircon Platform
 */

import { EchoNetEPC, EchoNetOperationMode, EchoNetSpecialValues, HomeKitHeatingCoolingState } from './types.js';
import { TEMPERATURE_LIMITS } from './constants.js';

/**
 * Validate EchoNet-Lite data value
 */
export function isValidEchoNetValue(value: string, epc: string): boolean {
  const hexValue = parseInt(value, 16);
  
  // Check for EchoNet-Lite special values
  if (hexValue === EchoNetSpecialValues.NOT_SET) {
    return false;
  }
  if (hexValue === EchoNetSpecialValues.OUT_OF_RANGE) {
    return false;
  }
  if (hexValue === EchoNetSpecialValues.UNDEFINED) {
    return false;
  }
  
  // EPC-specific validation
  switch (epc.toLowerCase()) {
  case EchoNetEPC.TARGET_TEMPERATURE:
    return hexValue >= 0 && hexValue <= 50; // Reasonable temperature range
  case EchoNetEPC.CURRENT_TEMPERATURE:
    return hexValue >= 0 && hexValue <= TEMPERATURE_LIMITS.ECHONET_MAX; // EchoNet-Lite temperature range
  case EchoNetEPC.OPERATION_STATUS:
    return hexValue === 0x30 || hexValue === 0x31; // ON or OFF only
  case EchoNetEPC.OPERATION_MODE:
    return Object.values(EchoNetOperationMode).includes(hexValue); // Valid modes only
  default:
    return true; // Allow other EPCs
  }
}

/**
 * Clamp value to HomeKit valid range
 */
export function clampToHomeKitRange(value: number, characteristic: 'TargetTemperature' | 'CurrentTemperature'): number {
  switch (characteristic) {
  case 'TargetTemperature':
    return Math.max(TEMPERATURE_LIMITS.HOMEKIT_TARGET_MIN, Math.min(TEMPERATURE_LIMITS.HOMEKIT_TARGET_MAX, value));
  case 'CurrentTemperature':
    return Math.max(TEMPERATURE_LIMITS.HOMEKIT_CURRENT_MIN, Math.min(TEMPERATURE_LIMITS.HOMEKIT_CURRENT_MAX, value));
  default:
    return value;
  }
}

/**
 * Convert EchoNet-Lite operation mode to HomeKit mode
 */
export function convertEchoNetModeToHomeKit(mode: number): HomeKitHeatingCoolingState {
  switch (mode) {
  case EchoNetOperationMode.AUTO:
    return HomeKitHeatingCoolingState.AUTO;
  case EchoNetOperationMode.COOL:
    return HomeKitHeatingCoolingState.COOL;
  case EchoNetOperationMode.HEAT:
    return HomeKitHeatingCoolingState.HEAT;
  case EchoNetOperationMode.DRY:
    return HomeKitHeatingCoolingState.COOL; // Dry -> Cool
  case EchoNetOperationMode.FAN:
    return HomeKitHeatingCoolingState.COOL; // Fan -> Cool
  default:
    return HomeKitHeatingCoolingState.COOL; // Default to Cool
  }
}

/**
 * Convert HomeKit mode to EchoNet-Lite operation mode
 */
export function convertHomeKitModeToEchoNet(mode: HomeKitHeatingCoolingState): number {
  switch (mode) {
  case HomeKitHeatingCoolingState.AUTO:
    return EchoNetOperationMode.AUTO;
  case HomeKitHeatingCoolingState.COOL:
    return EchoNetOperationMode.COOL;
  case HomeKitHeatingCoolingState.HEAT:
    return EchoNetOperationMode.HEAT;
  case HomeKitHeatingCoolingState.OFF:
  default:
    return EchoNetOperationMode.COOL; // Default to Cool when turning on
  }
}

/**
 * Handle current heating cooling state for AUTO mode
 * HomeKit CurrentHeatingCoolingState doesn't support AUTO (value 3)
 */
export function handleAutoModeForCurrentState(
  homeKitMode: HomeKitHeatingCoolingState,
  currentTemp?: number,
  targetTemp?: number,
): HomeKitHeatingCoolingState {
  if (homeKitMode !== HomeKitHeatingCoolingState.AUTO) {
    return homeKitMode;
  }
  
  // For AUTO mode, determine actual heating/cooling state based on temperature
  if (currentTemp !== undefined && targetTemp !== undefined) {
    return targetTemp > currentTemp ? HomeKitHeatingCoolingState.HEAT : HomeKitHeatingCoolingState.COOL;
  }
  
  // Default to Cool if temperature data unavailable
  return HomeKitHeatingCoolingState.COOL;
}

/**
 * Parse EchoNet-Lite temperature value (handles negative temperatures)
 */
export function parseEchoNetTemperature(value: string): number {
  const temp = parseInt(value, 16);
  return temp > TEMPERATURE_LIMITS.ECHONET_MAX ? (temp - 256) : temp; // Handle negative temperatures
}

/**
 * Generate a unique request key for EchoNet-Lite requests
 */
export function generateRequestKey(ip: string, eoj: string, epc: string, timestamp?: number): string {
  const ts = timestamp || Date.now();
  return `${ip}_${eoj}_${epc}_${ts}`;
}

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const delay = baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, maxDelayMs);
}

/**
 * Create a promise with timeout
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage?: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage || `Timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

/**
 * Delay execution for specified milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safely parse hex string to number
 */
export function safeParseHex(value: string): number | null {
  try {
    const parsed = parseInt(value, 16);
    return isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Check if device should be throttled
 */
export function shouldThrottleDevice(lastRequestTime: number, minIntervalMs: number): number {
  const timeSinceLastRequest = Date.now() - lastRequestTime;
  return timeSinceLastRequest < minIntervalMs ? minIntervalMs - timeSinceLastRequest : 0;
}