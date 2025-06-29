/**
 * Type definitions for EchoNet-Lite Aircon Platform
 */

export interface AirConditionerDevice {
  ip: string;
  eoj: string;
  deviceId: string;
  manufacturer?: string;
  manufacturerCode?: string;
  model?: string;
  serialNumber?: string;
}

export interface EchoNetLiteMessage {
  SEOJ: string;
  DEOJ: string;
  EPC: string;
  PDC: number;
  EDT: string;
  ESV: number;
  DETAILs: Record<string, string>;
  seoj: string;
  deoj: string;
  epc: string;
  pdc: number;
  edt: string;
  esv: number;
}

export interface EchoNetLiteRemoteInfo {
  address: string;
  port: number;
  family: string;
}

export interface DeviceStateDetails {
  [epc: string]: string;
}

export interface EchoNetInitializeCallback {
  (rinfo: EchoNetLiteRemoteInfo, els: EchoNetLiteMessage, err?: unknown): void;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface PollingConfig {
  enabled: boolean;
  intervalMs: number;
}

export interface OperationState {
  isOn: boolean;
  mode: number;
}

export interface DeviceRequest {
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
  timestamp: number;
  ip: string;
  eoj: string;
  epc: string;
}

export type PendingRequests = Map<string, DeviceRequest>;

/**
 * EchoNet-Lite EPC codes
 */
export enum EchoNetEPC {
  OPERATION_STATUS = '80',
  OPERATION_MODE = 'b0',
  TARGET_TEMPERATURE = 'b3',
  CURRENT_TEMPERATURE = 'bb',
  MANUFACTURER_CODE = '8a',
  NOTIFICATION_PROPERTY_MAP = '9e',
}

/**
 * EchoNet-Lite operation modes
 */
export enum EchoNetOperationMode {
  AUTO = 0x41,
  COOL = 0x42,
  HEAT = 0x43,
  DRY = 0x44,
  FAN = 0x45,
}

/**
 * HomeKit heating/cooling states
 */
export enum HomeKitHeatingCoolingState {
  OFF = 0,
  HEAT = 1,
  COOL = 2,
  AUTO = 3,
}

/**
 * EchoNet-Lite special values
 */
export enum EchoNetSpecialValues {
  NOT_SET = 0xFD,
  OUT_OF_RANGE = 0xFE,
  UNDEFINED = 0xFF,
}

/**
 * Custom error types for better error handling
 */
export class EchoNetError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly deviceId?: string,
  ) {
    super(message);
    this.name = 'EchoNetError';
  }
}

export class HomeKitError extends Error {
  constructor(
    message: string,
    public readonly characteristic: string,
    public readonly value?: unknown,
  ) {
    super(message);
    this.name = 'HomeKitError';
  }
}