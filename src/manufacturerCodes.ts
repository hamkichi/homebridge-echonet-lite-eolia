/**
 * ECHONET Lite manufacturer code mapping for air conditioner manufacturers
 * Based on official ECHONET Lite manufacturer code list as of June 2025
 */

export interface ManufacturerInfo {
  name: string;
  shortName: string;
}

/**
 * ECHONET Lite major air conditioner manufacturer codes
 * Simplified company names without redundant suffixes like Corporation, Ltd., etc.
 */
export const AIRCON_MANUFACTURERS: Record<string, ManufacturerInfo> = {
  // Major Japanese air conditioner manufacturers
  '000006': { name: 'Mitsubishi Electric Corporation', shortName: 'Mitsubishi Electric' },
  '00000b': { name: 'Panasonic Holdings Corporation', shortName: 'Panasonic' },
  '000016': { name: 'Toshiba Corporation', shortName: 'Toshiba' },
  '000005': { name: 'Sharp Corporation', shortName: 'Sharp' },
  '000008': { name: 'Daikin Industries, Ltd.', shortName: 'Daikin' },
  '000001': { name: 'Hitachi, Ltd.', shortName: 'Hitachi' }, // Legacy - withdrew in 2023
  '000022': { name: 'Hitachi Global Life Solutions, Ltd.', shortName: 'Hitachi' },
  '00008a': { name: 'Fujitsu General Limited', shortName: 'Fujitsu General' },
  '000069': { name: 'Toshiba Lifestyle Co., Ltd.', shortName: 'Toshiba Lifestyle' },
  '000017': { name: 'Japan Carrier Corporation', shortName: 'Carrier Japan' },
  '0000cc': { name: 'Hitachi Johnson Controls Air Conditioning, Inc.', shortName: 'Hitachi Johnson Controls' },

  // Commercial air conditioning specialists
  '000034': { name: 'Mitsubishi Electric Engineering Co., Ltd.', shortName: 'Mitsubishi Electric Engineering' },

  // International manufacturers (with Japan presence)
  '000115': { name: 'Huawei Technologies Japan K.K.', shortName: 'Huawei' },
  '0000b3': { name: 'LG Electronics Inc.', shortName: 'LG Electronics' },
  '0000b5': { name: 'Samsung Electronics Co., Ltd.', shortName: 'Samsung Electronics' },
  '0000d6': { name: 'Carrier Corporation', shortName: 'Carrier' },
};

/**
 * Get manufacturer information from ECHONET Lite manufacturer code
 * @param manufacturerCode - 6-character hex string manufacturer code (e.g., "00000b")
 * @returns ManufacturerInfo or null if code not found
 */
export function getManufacturerInfo(manufacturerCode: string): ManufacturerInfo | null {
  if (!manufacturerCode || typeof manufacturerCode !== 'string') {
    return null;
  }

  // Normalize the code to lowercase and ensure 6 characters
  const normalizedCode = manufacturerCode.toLowerCase().padStart(6, '0');

  return AIRCON_MANUFACTURERS[normalizedCode] || null;
}

/**
 * Get short manufacturer name from code
 * @param manufacturerCode - 6-character hex string manufacturer code
 * @returns Short manufacturer name or "Unknown" if not found
 */
export function getManufacturerName(manufacturerCode: string): string {
  const info = getManufacturerInfo(manufacturerCode);
  return info?.shortName || 'Unknown';
}

/**
 * Check if manufacturer code is recognized
 * @param manufacturerCode - 6-character hex string manufacturer code
 * @returns true if manufacturer is known
 */
export function isKnownManufacturer(manufacturerCode: string): boolean {
  return getManufacturerInfo(manufacturerCode) !== null;
}