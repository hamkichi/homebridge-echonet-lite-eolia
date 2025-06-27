declare module 'echonet-lite' {
  interface RInfo {
    address: string;
    family: 'IPv4' | 'IPv6';
    port: number;
    size: number;
  }

  interface ELData {
    EHD: string;
    TID: string;
    SEOJ: string;
    DEOJ: string;
    EDATA: string;
    ESV: string;
    OPC: string;
    DETAIL: string;
    DETAILs: Record<string, unknown>;
  }

  interface InitializeOptions {
    v4?: string;
    v6?: string;
    ignoreMe?: boolean;
    autoGetProperties?: boolean;
    autoGetDelay?: number;
    debugMode?: boolean;
  }

  type UserCallback = (rinfo: RInfo, els: ELData, err?: unknown) => void;

  export function initialize(
    objList: string[], 
    userFunc: UserCallback, 
    ipVer?: number, 
    options?: InitializeOptions
  ): Promise<unknown>;

  export function search(): void;

  export function sendOPC1(
    ip: string | RInfo, 
    seoj: string | number[], 
    deoj: string | number[], 
    esv: string | number, 
    epc: string | number, 
    edt: string | number | number[]
  ): string;

  export function sendDetails(
    ip: string,
    seoj: string | number[],
    deoj: string | number[],
    esv: string | number,
    details: Record<string, number[]>
  ): Promise<string>;

  export const facilities: Record<string, Record<string, Record<string, unknown>>>;
}