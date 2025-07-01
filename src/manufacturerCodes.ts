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
 * @param manufacturerCode - manufacturer code in various formats (hex string, number array, etc.)
 * @returns ManufacturerInfo or null if code not found
 */
export function getManufacturerInfo(manufacturerCode: string | number[] | number | undefined): ManufacturerInfo | null {
  if (!manufacturerCode && manufacturerCode !== 0) {
    return null;
  }

  let normalizedCode: string;

  if (Array.isArray(manufacturerCode)) {
    // Handle number array format (e.g., [0, 0, 11] for Panasonic)
    normalizedCode = manufacturerCode
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')
      .toLowerCase();
  } else if (typeof manufacturerCode === 'number') {
    // Handle single number format (e.g., 11 for Panasonic)
    normalizedCode = manufacturerCode.toString(16).padStart(6, '0').toLowerCase();
  } else if (typeof manufacturerCode === 'string') {
    // Handle string format
    normalizedCode = manufacturerCode
      .replace(/[^0-9a-fA-F]/g, '') // Remove non-hex characters
      .toLowerCase()
      .padStart(6, '0');
  } else {
    return null;
  }

  return AIRCON_MANUFACTURERS[normalizedCode] || null;
}

/**
 * Get short manufacturer name from code
 * @param manufacturerCode - manufacturer code in various formats
 * @returns Short manufacturer name or "Unknown" if not found
 */
export function getManufacturerName(manufacturerCode: string | number[] | number | undefined): string {
  const info = getManufacturerInfo(manufacturerCode);
  return info?.shortName || 'Unknown';
}

/**
 * Check if manufacturer code is recognized
 * @param manufacturerCode - manufacturer code in various formats
 * @returns true if manufacturer is known
 */
export function isKnownManufacturer(manufacturerCode: string | number[] | number | undefined): boolean {
  return getManufacturerInfo(manufacturerCode) !== null;
}