/**
 * Type definitions for Echonet Lite API and internal interfaces
 */

export interface EchonetDevice {
  address: string;
  eoj: number[][];
}

export interface EchonetDiscoveryResult {
  device: {
    address: string;
    eoj: number[][];
  };
}

export interface EchonetPropertyResponse {
  message: {
    data: {
      uid?: string;
      status?: boolean;
      mode?: number;
      temperature?: number;
      code?: string;
    };
  };
}

export interface EchonetNotification {
  device: EchonetDevice;
  message: {
    prop: Array<{
      epc: number;
      edt?: {
        status?: boolean;
        mode?: number;
        temperature?: number;
      };
    }>;
  };
}

export interface JobResolveReject {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export interface AccessoryContext {
  device: EchonetDevice;
  address: string;
  eoj: number[];
  uuid: string;
  manufacturerCode?: string;
  manufacturer?: {
    name: string;
    shortName: string;
  };
}

export interface EchonetSetPropertyValue {
  status?: boolean;
  mode?: number;
  temperature?: number;
}

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

export interface PropertyCache {
  [epc: number]: CacheEntry<unknown>;
}