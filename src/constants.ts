/**
 * Constants for EchoNet-Lite Aircon Platform
 */

// Request timing constants
export const REQUEST_TIMING = {
  MIN_DEVICE_INTERVAL_MS: 800,      // Minimum interval between requests to same device
  REQUEST_QUEUE_DELAY_MS: 100,      // Delay between queued requests
  CACHE_TIMEOUT_MS: 2000,           // Cache validity timeout
  QUICK_TIMEOUT_MS: 800,            // Quick timeout for HomeKit responsiveness
  STANDARD_TIMEOUT_MS: 2000,        // Standard timeout for requests
  LONG_TIMEOUT_MS: 5000,            // Long timeout for setup operations
  INF_REFRESH_DELAY_MS: 500,        // Delay before refreshing state after INF
  HOMEKIT_UPDATE_INTERVAL_MS: 50,   // Interval between HomeKit characteristic updates
  VERIFICATION_DELAY_MS: 200,       // Delay before verification
} as const;

// Retry configuration defaults
export const DEFAULT_RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 8000,
} as const;

// Polling configuration defaults
export const DEFAULT_POLLING_CONFIG = {
  enabled: true,
  intervalMs: 60000, // 1 minute
} as const;

// Temperature limits
export const TEMPERATURE_LIMITS = {
  HOMEKIT_TARGET_MIN: 10,
  HOMEKIT_TARGET_MAX: 38,
  HOMEKIT_CURRENT_MIN: -270,
  HOMEKIT_CURRENT_MAX: 100,
  AC_PRACTICAL_MIN: 16,
  AC_PRACTICAL_MAX: 30,
  ECHONET_MAX: 125,
  TOLERANCE: 0.5,
} as const;

// EchoNet-Lite protocol constants
export const ECHONET_PROTOCOL = {
  OPERATION_ON: 0x30,
  OPERATION_OFF: 0x31,
  GET_REQUEST: 0x62,
  SET_REQUEST: 0x61,
  RESPONSE_OK: 0x72,
  NOTIFICATION: 0x73,
  SOURCE_EOJ: [0x05, 0xff, 0x01],
} as const;

// Logging configuration
export const LOG_THROTTLING = {
  UNMATCHED_LOG_INTERVAL_MS: 60000, // Log unmatched responses at most once per minute
  INF_NOTIFICATION_CHECK_INTERVAL_MS: 15 * 60 * 1000, // 15 minutes
} as const;

// ECHONET Lite manufacturer codes
export const MANUFACTURER_CODES: Record<string, string> = {
  // Major domestic air conditioner manufacturers
  '000006': 'Mitsubishi Electric',     // 三菱電機（霧ヶ峰）
  '00000b': 'Panasonic',               // パナソニック（エオリア）
  '000016': 'Toshiba',                 // 東芝（大清快）
  '000005': 'Sharp',                   // シャープ（プラズマクラスター）
  '000008': 'Daikin',                  // ダイキン（うるさらX）
  '000001': 'Hitachi',                 // 日立（白くまくん）※2023年退会
  '000022': 'Hitachi Global Life Solutions', // 日立グローバルライフソリューションズ（白くまくん）
  '00008a': 'Fujitsu General',         // 富士通ゼネラル（ノクリア）
  '000069': 'Toshiba Lifestyle',       // 東芝ライフスタイル
  '000017': 'Japan Carrier',           // 日本キヤリア（旧東芝キヤリア）
  '0000cc': 'Hitachi Johnson Controls Air Conditioning', // 日立ジョンソンコントロールズ空調
  
  // Commercial air conditioner specialized manufacturers
  '000034': 'Mitsubishi Electric Engineering', // 三菱電機エンジニアリング（業務用）
  
  // Major overseas air conditioner manufacturers (deployed in Japan)
  '000115': 'Huawei Technologies Japan',      // 華為技術日本（スマートエアコン）
  '0000b3': 'LG Electronics',                 // LG電子（韓国）
  '0000b5': 'Samsung Electronics',            // サムスン電子（韓国）
  '0000d6': 'Carrier',                        // キャリア（アメリカ）
} as const;

// Default manufacturer
export const UNKNOWN_MANUFACTURER = 'Unknown Manufacturer';
export const DEFAULT_MANUFACTURER_CODE = '000000';