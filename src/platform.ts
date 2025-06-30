import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { AirConditionerAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import {
  AirConditionerDevice,
  DeviceStateDetails,
  EchoNetLiteMessage,
  EchoNetLiteRemoteInfo,
  PendingRequests,
  PollingConfig,
  RetryConfig,
} from './types.js';
import {
  DEFAULT_POLLING_CONFIG,
  DEFAULT_RETRY_CONFIG,
  MANUFACTURER_CODES,
  REQUEST_TIMING,
  UNKNOWN_MANUFACTURER,
} from './constants.js';

// This is only required when using Custom Services and Characteristics not support by HomeKit
import { EveHomeKitTypes } from 'homebridge-lib/EveHomeKitTypes';

// EchoNet-Lite library
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const EL = require('echonet-lite');


/**
 * EchoNetLiteAirconPlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class EchoNetLiteAirconPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  // This is only required when using Custom Services and Characteristics not support by HomeKit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomServices: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomCharacteristics: any;

  // EchoNet-Lite specific properties
  private elSocket: unknown = null;
  private discoveredDevices: Map<string, AirConditionerDevice> = new Map();
  private discoveryTimeout: NodeJS.Timeout | null = null;
  private pendingRequests: PendingRequests = new Map();
  private requestQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;
  private lastRequestTime: Map<string, number> = new Map(); // Track last request time per device
  
  // Retry configuration
  private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;
  
  // Polling configuration for external state changes
  private pollingConfig: PollingConfig = DEFAULT_POLLING_CONFIG;
  private pollingTimers: Map<string, NodeJS.Timeout> = new Map();
  
  // Device state cache for change detection
  private deviceStateCache: Map<string, Record<string, string>> = new Map();
  
  // Log throttling for unmatched responses
  private lastUnmatchedLogTime: Map<string, number> = new Map();
  private unmatchedLogInterval = REQUEST_TIMING.QUICK_TIMEOUT_MS; // Log unmatched responses throttling
  
  // INF notification tracking
  private infNotificationCount: Map<string, number> = new Map();
  private lastInfNotificationTime: Map<string, number> = new Map();

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // This is only required when using Custom Services and Characteristics not support by HomeKit
    this.CustomServices = new EveHomeKitTypes(this.api).Services;
    this.CustomCharacteristics = new EveHomeKitTypes(this.api).Characteristics;

    // Override retry configuration if provided in config
    if (this.config.retry) {
      if (typeof this.config.retry.maxRetries === 'number' && this.config.retry.maxRetries >= 0) {
        this.retryConfig.maxRetries = this.config.retry.maxRetries;
      }
      if (typeof this.config.retry.baseDelayMs === 'number' && this.config.retry.baseDelayMs > 0) {
        this.retryConfig.baseDelayMs = this.config.retry.baseDelayMs;
      }
      if (typeof this.config.retry.maxDelayMs === 'number' && this.config.retry.maxDelayMs > 0) {
        this.retryConfig.maxDelayMs = this.config.retry.maxDelayMs;
      }
    }
    
    // Override polling configuration if provided in config
    if (this.config.polling) {
      if (typeof this.config.polling.enabled === 'boolean') {
        this.pollingConfig.enabled = this.config.polling.enabled;
      }
      if (typeof this.config.polling.intervalMs === 'number' && this.config.polling.intervalMs > 0) {
        this.pollingConfig.intervalMs = this.config.polling.intervalMs;
      }
    }

    this.log.info(`Polling configuration: enabled=${this.pollingConfig.enabled}, interval=${this.pollingConfig.intervalMs}ms`);
    this.log.debug('Finished initializing platform:', this.config.name);
    this.log.debug('Retry configuration:', this.retryConfig);
    this.log.debug('Polling configuration:', this.pollingConfig);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // Initialize EchoNet-Lite and start discovery
      this.initializeEchoNetLite();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * Initialize EchoNet-Lite protocol and start device discovery
   */
  private async initializeEchoNetLite() {
    try {
      this.log.info('Initializing EchoNet-Lite protocol...');
      
      // We act as a controller
      const objList = ['05ff01']; // Controller object
      
      // Initialize EchoNet-Lite with callback for receiving data
      this.elSocket = await EL.initialize(objList, (rinfo: EchoNetLiteRemoteInfo, els: EchoNetLiteMessage, err?: unknown) => {
        if (err) {
          this.log.error('EchoNet-Lite receive error:', err);
          return;
        }
        
        this.handleEchoNetLiteMessage(rinfo, els);
      }, 4, { // IPv4 only
        ignoreMe: true,
        autoGetProperties: true,
        debugMode: false,
      });
      
      this.log.info('EchoNet-Lite initialized successfully');
      
      // Start device discovery
      this.startDiscovery();
      
      // Start INF notification monitoring
      this.startInfNotificationMonitoring();
      
    } catch (error) {
      this.log.error('Failed to initialize EchoNet-Lite:', error);
    }
  }

  /**
   * Start discovering EchoNet-Lite devices on the network
   */
  private startDiscovery() {
    this.log.info('Starting EchoNet-Lite device discovery...');
    
    // Send search command to discover devices
    EL.search();
    
    // Set timeout for discovery completion
    this.discoveryTimeout = setTimeout(() => {
      this.completeDiscovery();
    }, 10000); // 10 seconds discovery period
  }


  /**
   * Get additional details about discovered air conditioner
   */
  private async getDeviceDetails(device: AirConditionerDevice) {
    try {
      // Get manufacturer code (EPC: 0x8A)
      EL.sendOPC1(device.ip, [0x05, 0xff, 0x01], device.eoj, 0x62, 0x8a, []);
      
      // Get product code (EPC: 0x8C) if available
      EL.sendOPC1(device.ip, [0x05, 0xff, 0x01], device.eoj, 0x62, 0x8c, []);
      
      // Get serial number (EPC: 0x8D) if available  
      EL.sendOPC1(device.ip, [0x05, 0xff, 0x01], device.eoj, 0x62, 0x8d, []);
      
    } catch (error) {
      this.log.debug('Failed to get device details for', device.deviceId, ':', error);
    }
  }

  /**
   * Complete the discovery process and register found devices
   */
  private completeDiscovery() {
    this.log.info(`Discovery completed. Found ${this.discoveredDevices.size} air conditioner(s)`);
    
    // Clear discovery timeout
    if (this.discoveryTimeout) {
      clearTimeout(this.discoveryTimeout);
      this.discoveryTimeout = null;
    }
    
    // Register discovered devices as accessories
    this.registerDiscoveredDevices();
  }

  /**
   * Register discovered air conditioners as Homebridge accessories
   */
  private registerDiscoveredDevices() {
    for (const [, device] of this.discoveredDevices) {
      const uuid = this.api.hap.uuid.generate(device.deviceId);
      const existingAccessory = this.accessories.get(uuid);
      
      if (existingAccessory) {
        this.log.info('Restoring existing air conditioner from cache:', existingAccessory.displayName);
        existingAccessory.context.device = device;
        this.api.updatePlatformAccessories([existingAccessory]);
        new AirConditionerAccessory(this, existingAccessory);
        
        // Initialize existing accessory with actual device state
        this.initializeDeviceStateFromDevice(device).catch(error => {
          this.log.warn(`Failed to initialize existing accessory state for ${device.deviceId}:`, error instanceof Error ? error.message : 'unknown error');
        });
      } else {
        const displayName = `Air Conditioner (${device.ip})`;
        this.log.info('Adding new air conditioner:', displayName);
        
        const accessory = new this.api.platformAccessory(displayName, uuid);
        accessory.context.device = device;
        
        new AirConditionerAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        
        // Add to internal accessories map for INF notification handling
        this.accessories.set(uuid, accessory);
      }
      
      this.discoveredCacheUUIDs.push(uuid);
      
      // Initialize device state cache
      const deviceKey = `${device.ip}_${device.eoj}`;
      this.deviceStateCache.set(deviceKey, {});
      this.log.debug(`Initialized state cache for device ${deviceKey}`);
      
      // Initialize device with actual state from device (prevent default OFF status)
      this.initializeDeviceStateFromDevice(device).catch(error => {
        this.log.warn(`Failed to initialize device state for ${deviceKey}:`, error instanceof Error ? error.message : 'unknown error');
      });
      
      // Setup INF notifications for external operation detection
      this.setupNotificationProperties(device).catch(error => {
        this.log.warn(`Failed to setup INF notifications for ${device.deviceId}:`, error instanceof Error ? error.message : 'unknown error');
      });
      
      // Start polling for external state changes (as backup for devices that don't support INF)
      this.startPollingForDevice(device);
    }
    
    // Remove accessories that are no longer present
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        
        // Stop polling for removed device
        if (accessory.context.device) {
          this.stopPollingForDevice(accessory.context.device);
          
          // Clean up device state cache
          const deviceKey = `${accessory.context.device.ip}_${accessory.context.device.eoj}`;
          this.deviceStateCache.delete(deviceKey);
          this.log.debug(`Cleaned up state cache for removed device ${deviceKey}`);
        }
        
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  /**
   * Process request queue sequentially to avoid overwhelming devices
   */
  private async processRequestQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        try {
          await request();
          // Add delay between requests to avoid overwhelming the device
          await new Promise(resolve => setTimeout(resolve, REQUEST_TIMING.REQUEST_QUEUE_DELAY_MS));
        } catch (error) {
          this.log.error('Request queue processing error:', error);
        }
      }
    }
    
    this.isProcessingQueue = false;
  }

  /**
   * Send EchoNet-Lite GET request via queue to ensure sequential processing
   */
  async sendEchoNetRequest(ip: string, eoj: string, epc: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Add request to queue for sequential processing
      this.requestQueue.push(async () => {
        try {
          const result = await this.sendEchoNetRequestDirect(ip, eoj, epc);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      // Start processing queue if not already running
      this.processRequestQueue().catch(error => {
        this.log.error('Queue processing failed:', error);
      });
    });
  }

  /**
   * Send multiple EPC requests in a single EchoNet-Lite message to reduce TID usage
   */
  async sendEchoNetMultiRequest(ip: string, eoj: string, epcs: string[]): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      // Add multi-request to queue for sequential processing
      this.requestQueue.push(async () => {
        try {
          const results = await this.sendEchoNetMultiRequestDirect(ip, eoj, epcs);
          resolve(results);
        } catch (error) {
          reject(error);
        }
      });
      
      // Start processing queue if not already running
      this.processRequestQueue().catch(error => {
        this.log.error('Queue processing failed:', error);
      });
    });
  }

  /**
   * Direct multi-EPC EchoNet-Lite GET request implementation (used by queue)
   */
  private async sendEchoNetMultiRequestDirect(ip: string, eoj: string, epcs: string[]): Promise<Record<string, string>> {
    // Check if we need to throttle requests to this device
    const deviceKey = `${ip}_${eoj}`;
    const lastRequest = this.lastRequestTime.get(deviceKey) || 0;
    const timeSinceLastRequest = Date.now() - lastRequest;
    
    if (timeSinceLastRequest < REQUEST_TIMING.MIN_DEVICE_INTERVAL_MS) { // Minimum interval between requests to same device
      await new Promise(resolve => setTimeout(resolve, REQUEST_TIMING.MIN_DEVICE_INTERVAL_MS - timeSinceLastRequest));
    }
    
    return new Promise((resolve, reject) => {
      try {
        // Create unique request key based on timestamp, device, and random element
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const requestKey = `${ip}_${eoj}_multi_${timestamp}_${randomSuffix}`;
        
        this.log.debug(`Sending multi-EPC request to ${ip} for EPCs: ${epcs.join(', ')}, key: ${requestKey}`);
        
        // Prepare details object for sendDetails
        const details: Record<string, number[]> = {};
        epcs.forEach(epc => {
          details[epc] = []; // Empty array for GET requests
        });
        
        // Store request for matching response
        const expectedResults: Record<string, string> = {};
        epcs.forEach(epc => {
          const epcRequestKey = `${ip}_${eoj}_${epc}_${timestamp}_${randomSuffix}`;
          this.pendingRequests.set(epcRequestKey, {
            resolve: (value: unknown) => {
              expectedResults[epc] = value as string;
              // Check if all EPCs have been resolved
              if (Object.keys(expectedResults).length === epcs.length) {
                resolve(expectedResults);
              }
            },
            reject,
            timestamp,
            ip,
            eoj,
            epc,
          });
        });
        
        // Update last request time
        this.lastRequestTime.set(deviceKey, timestamp);
        
        // Send the actual EchoNet-Lite multi-request using sendDetails
        EL.sendDetails(ip, [0x05, 0xff, 0x01], eoj, 0x62, details);
        
        // Set timeout for request
        setTimeout(() => {
          let hasUnresolved = false;
          epcs.forEach(epc => {
            const epcRequestKey = `${ip}_${eoj}_${epc}_${timestamp}_${randomSuffix}`;
            if (this.pendingRequests.has(epcRequestKey)) {
              this.pendingRequests.delete(epcRequestKey);
              hasUnresolved = true;
            }
          });
          
          if (hasUnresolved) {
            // Return partial results if any EPCs succeeded
            if (Object.keys(expectedResults).length > 0) {
              this.log.warn(`Multi-request partial timeout: ${requestKey}, got ${Object.keys(expectedResults).length}/${epcs.length} responses`);
              resolve(expectedResults);
            } else {
              const error = new Error(`Timeout waiting for multi-response from ${ip} for EPCs ${epcs.join(', ')}`);
              this.log.warn(`Multi-request complete timeout: ${requestKey}`);
              reject(error);
            }
          }
        }, 3000); // 3 second timeout for multi-requests
        
      } catch (error) {
        this.log.error(`Failed to send EchoNet multi-request: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * Direct EchoNet-Lite GET request implementation (used by queue)
   */
  private async sendEchoNetRequestDirect(ip: string, eoj: string, epc: string): Promise<string> {
    // Check if we need to throttle requests to this device
    const deviceKey = `${ip}_${eoj}`;
    const lastRequest = this.lastRequestTime.get(deviceKey) || 0;
    const timeSinceLastRequest = Date.now() - lastRequest;
    
    if (timeSinceLastRequest < REQUEST_TIMING.MIN_DEVICE_INTERVAL_MS) { // Minimum interval between requests to same device
      await new Promise(resolve => setTimeout(resolve, REQUEST_TIMING.MIN_DEVICE_INTERVAL_MS - timeSinceLastRequest));
    }
    
    return new Promise((resolve, reject) => {
      try {
        // Create unique request key based on timestamp, device, and random element
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const requestKey = `${ip}_${eoj}_${epc}_${timestamp}_${randomSuffix}`;
        
        this.log.debug(`Sending EPC ${epc} to ${ip}, key: ${requestKey}`);
        
        // Store request for matching response
        this.pendingRequests.set(requestKey, {
          resolve,
          reject,
          timestamp,
          ip,
          eoj,
          epc,
        });
        
        // Update last request time
        this.lastRequestTime.set(deviceKey, timestamp);
        
        // Send the actual EchoNet-Lite request
        EL.sendOPC1(ip, [0x05, 0xff, 0x01], eoj, 0x62, epc, []);
        
        // Set timeout for request (shorter for Homebridge compatibility)
        setTimeout(() => {
          if (this.pendingRequests.has(requestKey)) {
            this.pendingRequests.delete(requestKey);
            const error = new Error(`Timeout waiting for response from ${ip} for EPC ${epc}`);
            this.log.warn(`Request timeout: ${requestKey}`);
            reject(error);
          }
        }, REQUEST_TIMING.STANDARD_TIMEOUT_MS); // 2 second timeout
        
      } catch (error) {
        this.log.error(`Failed to send EchoNet request: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * Send EchoNet-Lite SET request via queue to ensure sequential processing
   */
  async sendEchoNetSetRequest(ip: string, eoj: string, epc: string, data: number[]): Promise<void> {
    return new Promise((resolve, reject) => {
      // Add SET request to queue for sequential processing
      this.requestQueue.push(async () => {
        try {
          await this.sendEchoNetSetRequestDirect(ip, eoj, epc, data);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      
      // Start processing queue if not already running
      this.processRequestQueue().catch(error => {
        this.log.error('Queue processing failed:', error);
      });
    });
  }

  /**
   * Direct EchoNet-Lite SET request implementation (used by queue)
   */
  private async sendEchoNetSetRequestDirect(ip: string, eoj: string, epc: string, data: number[]): Promise<void> {
    // Check if we need to throttle requests to this device
    const deviceKey = `${ip}_${eoj}`;
    const lastRequest = this.lastRequestTime.get(deviceKey) || 0;
    const timeSinceLastRequest = Date.now() - lastRequest;
    
    if (timeSinceLastRequest < REQUEST_TIMING.MIN_DEVICE_INTERVAL_MS) { // Minimum interval between requests to same device
      await new Promise(resolve => setTimeout(resolve, REQUEST_TIMING.MIN_DEVICE_INTERVAL_MS - timeSinceLastRequest));
    }
    
    return new Promise((resolve, reject) => {
      try {
        // Create unique request key based on timestamp and device
        const timestamp = Date.now();
        const requestKey = `${ip}_${eoj}_${epc}_set_${timestamp}`;
        
        this.log.debug(`Sending SET EPC ${epc} to ${ip} with data: [${data.join(', ')}], key: ${requestKey}`);
        
        // Store request for matching response
        this.pendingRequests.set(requestKey, {
          resolve: () => resolve(),
          reject,
          timestamp,
          ip,
          eoj,
          epc,
        });
        
        // Update last request time
        this.lastRequestTime.set(deviceKey, timestamp);
        
        // Send the actual EchoNet-Lite SET request (0x61 = SETI)
        EL.sendOPC1(ip, [0x05, 0xff, 0x01], eoj, 0x61, epc, data);
        
        // Set timeout for request
        setTimeout(() => {
          if (this.pendingRequests.has(requestKey)) {
            this.pendingRequests.delete(requestKey);
            const error = new Error(`Timeout waiting for SET response from ${ip} for EPC ${epc}`);
            this.log.warn(`SET request timeout: ${requestKey}`);
            reject(error);
          }
        }, 3000); // 3 second timeout for SET requests
        
      } catch (error) {
        this.log.error(`Failed to send EchoNet SET request: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * Enhanced message handler that processes responses for pending requests
   */
  private handleEchoNetLiteMessage(rinfo: EchoNetLiteRemoteInfo, els: EchoNetLiteMessage) {
    // Only log detailed message info at trace level to reduce noise
    if (this.log.debug && process.env.HOMEBRIDGE_DEBUG) {
      this.log.debug('Received EchoNet-Lite message from', rinfo.address, ':', els);
    }
    
    // TEMPORARY DEBUG: Check ESV value type and format
    this.log.warn(`DEBUG ESV - Value: ${els.ESV}, Type: ${typeof els.ESV}, Hex: 0x${els.ESV?.toString(16)}, String: '${els.ESV}'`);
    
    // Track unmatched responses to detect potential issues
    let hasMatchedRequests = false;
    
    // Check if this is a response to a pending request
    // Support both string and numeric ESV values for compatibility
    const esvValue = els.ESV as unknown;
    const isGetRes = esvValue === 0x72 || esvValue === '72';
    const isSetRes = esvValue === 0x71 || esvValue === '71';
    
    if ((isGetRes || isSetRes) && els.DETAILs) { // GET_RES or SET_RES
      const responseType = isGetRes ? 'GET_RES' : 'SET_RES';
      
      for (const [epc, value] of Object.entries(els.DETAILs)) {
        // Find the most recent pending request for this device/EPC combination
        // Try exact key match first (more precise), then fallback to timestamp-based matching
        let mostRecentRequest = null;
        let mostRecentKey = null;
        let mostRecentTime = 0;
        
        for (const [key, request] of this.pendingRequests.entries()) {
          if (request.ip === rinfo.address && 
              request.eoj === els.SEOJ && 
              request.epc === epc) {
            // Prefer exact key pattern match if available
            if (key.includes(`${rinfo.address}_${els.SEOJ}_${epc}_`)) {
              if (request.timestamp > mostRecentTime) {
                mostRecentRequest = request;
                mostRecentKey = key;
                mostRecentTime = request.timestamp;
              }
            }
          }
        }
        
        if (mostRecentRequest && mostRecentKey) {
          hasMatchedRequests = true;
          this.log.debug(`Resolved ${responseType} for ${rinfo.address} EPC ${epc}: ${value}`);
          this.pendingRequests.delete(mostRecentKey);
          // For GET_RES, pass the value; for SET_RES, just resolve (void)
          if (isGetRes) {
            mostRecentRequest.resolve(value);
          } else {
            mostRecentRequest.resolve('');
          }
        }
      }
      
      // Only log unmatched responses occasionally to avoid spam
      if (!hasMatchedRequests && this.shouldLogUnmatchedResponse(rinfo.address)) {
        const epcCount = Object.keys(els.DETAILs || {}).length;
        this.log.debug(`Received unmatched ${responseType} from ${rinfo.address} (${epcCount} EPCs, ${this.pendingRequests.size} pending)`);
      }
    }
    
    // Handle INF notifications (external operations)
    const isInfNotification = esvValue === 0x73 || esvValue === '73';
    if (isInfNotification && els.DETAILs && els.SEOJ && els.SEOJ.startsWith('0130')) {
      // Track INF notification reception
      const deviceKey = `${rinfo.address}_${els.SEOJ}`;
      const currentCount = this.infNotificationCount.get(deviceKey) || 0;
      this.infNotificationCount.set(deviceKey, currentCount + 1);
      this.lastInfNotificationTime.set(deviceKey, Date.now());
      
      // INF from air conditioner - Enhanced logging for debugging
      this.log.debug(`Received INF notification #${currentCount + 1} from ${rinfo.address} (${els.SEOJ}): EPCs ${Object.keys(els.DETAILs).join(', ')}`);
      
      // Update state cache with INF notification data
      const currentState = this.deviceStateCache.get(deviceKey) || {};
      const changes: Record<string, string> = {};
      
      for (const [epc, value] of Object.entries(els.DETAILs)) {
        const stringValue = value as string;
        this.log.debug(`  EPC ${epc}: ${currentState[epc]} -> ${stringValue}`);
        if (currentState[epc] !== stringValue) {
          changes[epc] = stringValue;
        }
        currentState[epc] = stringValue;
      }
      this.deviceStateCache.set(deviceKey, currentState);
      
      // Process all INF notifications, even if no changes detected
      if (Object.keys(changes).length > 0) {
        this.log.info(`🔔 External operation detected on ${rinfo.address}: ${Object.keys(changes).join(', ')} changed`);
        this.handleDeviceStateChange(rinfo.address, els.SEOJ, changes);
      } else {
        this.log.debug(`INF notification received but no state changes detected for ${rinfo.address}`);
      }
    }
    
    // Original discovery logic for air conditioners
    if (els.SEOJ && els.SEOJ.startsWith('0130')) {
      const deviceId = `${rinfo.address}_${els.SEOJ}`;
      
      if (!this.discoveredDevices.has(deviceId)) {
        const device: AirConditionerDevice = {
          ip: rinfo.address,
          eoj: els.SEOJ,
          deviceId: deviceId,
        };
        
        this.discoveredDevices.set(deviceId, device);
        this.log.info(`Discovered air conditioner at ${rinfo.address} (${els.SEOJ})`);
        
        // Try to get additional device information
        this.getDeviceDetails(device);
      }
    }
  }

  /**
   * Check if error is retryable (timeout errors only)
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.includes('Timeout waiting for response') ||
             error.message.includes('Quick timeout');
    }
    return false;
  }

  /**
   * Calculate delay for exponential backoff
   */
  private calculateBackoffDelay(attempt: number): number {
    const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempt);
    return Math.min(delay, this.retryConfig.maxDelayMs);
  }

  /**
   * Generic method to get metric value from EchoNet-Lite device with retry
   */
  private async getMetricValue<T>(
    device: AirConditionerDevice,
    epc: string,
    metricName: string,
    parser: (response: string) => T,
  ): Promise<T> {
    let lastError: unknown;
    
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.calculateBackoffDelay(attempt - 1);
          this.log.debug(`Retrying ${metricName} for ${device.ip}, attempt ${attempt}/${this.retryConfig.maxRetries}, delay: ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const response = await this.sendEchoNetRequest(device.ip, device.eoj, epc);
        
        if (attempt > 0) {
          this.log.info(`Successfully retrieved ${metricName} for ${device.ip} after ${attempt} retries`);
        }
        
        return parser(response);
        
      } catch (error) {
        lastError = error;
        
        // Only retry for timeout errors
        if (!this.isRetryableError(error)) {
          this.log.error(`Non-retryable error getting ${metricName} for ${device.ip}:`, error);
          throw error;
        }
        
        if (attempt === this.retryConfig.maxRetries) {
          this.log.error(`Failed to get ${metricName} for ${device.ip} after ${this.retryConfig.maxRetries} retries:`, error);
          break;
        }
        
        this.log.warn(`Timeout getting ${metricName} for ${device.ip}, attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}`);
      }
    }
    
    throw lastError;
  }

  /**
   * Generic method to set metric value on EchoNet-Lite device with retry
   */
  private async setMetricValue<T>(
    device: AirConditionerDevice,
    epc: string,
    metricName: string,
    value: T,
    dataConverter: (value: T) => number[],
  ): Promise<void> {
    let lastError: unknown;
    const data = dataConverter(value);
    
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.calculateBackoffDelay(attempt - 1);
          this.log.debug(`Retrying set ${metricName} for ${device.ip}, attempt ${attempt}/${this.retryConfig.maxRetries}, delay: ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        await this.sendEchoNetSetRequest(device.ip, device.eoj, epc, data);
        
        if (attempt > 0) {
          this.log.info(`Successfully set ${metricName} to ${value} for ${device.ip} after ${attempt} retries`);
        } else {
          this.log.debug(`Successfully set ${metricName} to ${value} for ${device.ip}`);
        }
        
        return; // Success
        
      } catch (error) {
        lastError = error;
        
        // Only retry for timeout errors
        if (!this.isRetryableError(error)) {
          this.log.error(`Non-retryable error setting ${metricName} for ${device.ip}:`, error);
          throw error;
        }
        
        if (attempt === this.retryConfig.maxRetries) {
          this.log.error(`Failed to set ${metricName} for ${device.ip} after ${this.retryConfig.maxRetries} retries:`, error);
          break;
        }
        
        this.log.warn(`Timeout setting ${metricName} for ${device.ip}, attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}`);
      }
    }
    
    throw lastError;
  }

  /**
   * Get operation state (ON/OFF)
   * EPC: 0x80 - Operation Status
   * 0x30 = ON, 0x31 = OFF
   */
  async getOperationState(device: AirConditionerDevice): Promise<boolean> {
    return this.getMetricValue(
      device,
      '80',
      'operation state',
      (response) => response === '30', // 0x30 = ON
    );
  }

  /**
   * Get current room temperature
   * EPC: 0xBB - Room Temperature
   */
  async getCurrentTemperature(device: AirConditionerDevice): Promise<number> {
    return this.getMetricValue(
      device,
      'bb',
      'current temperature',
      (response) => {
        // Validate response before conversion
        if (!this.isValidEchoNetValue(response, 'bb')) {
          throw new Error(`Invalid current temperature value: 0x${response} (EchoNet special value)`);
        }
        
        // Response is in hex, convert to decimal (temperature in °C)
        const temp = parseInt(response, 16);
        const actualTemp = temp > 125 ? (temp - 256) : temp; // Handle negative temperatures
        const clampedTemp = this.clampToHomeKitRange(actualTemp, 'CurrentTemperature');
        
        if (actualTemp !== clampedTemp) {
          throw new Error(`Current temperature ${actualTemp}°C is out of HomeKit range (-270-100°C)`);
        }
        
        return actualTemp;
      },
    );
  }

  /**
   * Get target temperature
   * EPC: 0xB3 - Temperature Setting
   */
  async getTargetTemperature(device: AirConditionerDevice): Promise<number> {
    return this.getMetricValue(
      device,
      'b3',
      'target temperature',
      (response) => {
        // Validate response before conversion
        if (!this.isValidEchoNetValue(response, 'b3')) {
          throw new Error(`Invalid target temperature value: 0x${response} (EchoNet special value)`);
        }
        
        const temp = parseInt(response, 16);
        const clampedTemp = this.clampToHomeKitRange(temp, 'TargetTemperature');
        
        if (temp !== clampedTemp) {
          throw new Error(`Target temperature ${temp}°C is out of HomeKit range (10-38°C)`);
        }
        
        return temp;
      },
    );
  }

  /**
   * Get operation mode
   * EPC: 0xB0 - Operation Mode Setting
   * 0x41=Auto, 0x42=Cool, 0x43=Heat, 0x44=Dry, 0x45=Fan
   */
  async getOperationMode(device: AirConditionerDevice): Promise<number> {
    return this.getMetricValue(
      device,
      'b0',
      'operation mode',
      (response) => {
        const mode = parseInt(response, 16);
        
        // Convert EchoNet-Lite mode to HomeKit mode
        switch (mode) {
        case 0x41: return 3; // Auto -> HomeKit Auto
        case 0x42: return 2; // Cool -> HomeKit Cool
        case 0x43: return 1; // Heat -> HomeKit Heat
        case 0x44: return 2; // Dry -> HomeKit Cool (closest match)
        case 0x45: return 2; // Fan -> HomeKit Cool (closest match)
        default: return 0;   // Unknown -> HomeKit Off
        }
      },
    );
  }

  /**
   * Set operation state (ON/OFF)
   * EPC: 0x80 - Operation Status
   * 0x30 = ON, 0x31 = OFF
   */
  async setOperationState(device: AirConditionerDevice, isOn: boolean): Promise<void> {
    await this.setMetricValue(
      device,
      '80',
      'operation state',
      isOn,
      (state) => [state ? 0x30 : 0x31], // 0x30 = ON, 0x31 = OFF
    );
    
    // Update local cache immediately after successful SET operation
    this.updateDeviceStateCache(device, '80', isOn ? '30' : '31');
    
    // Also update HomeKit characteristics immediately to provide instant feedback
    this.updateHomeKitCharacteristicsAfterSet(device, '80', isOn ? '30' : '31');
  }

  /**
   * Set target temperature
   * EPC: 0xB3 - Temperature Setting
   */
  async setTargetTemperature(device: AirConditionerDevice, temperature: number): Promise<void> {
    await this.setMetricValue(
      device,
      'b3',
      'target temperature',
      temperature,
      (temp) => [Math.round(temp)], // Temperature in °C as single byte
    );
    
    // Update local cache immediately after successful SET operation
    const hexValue = Math.round(temperature).toString(16);
    this.updateDeviceStateCache(device, 'b3', hexValue);
    
    // Also update HomeKit characteristics immediately to provide instant feedback
    this.updateHomeKitCharacteristicsAfterSet(device, 'b3', hexValue);
  }

  /**
   * Set operation mode
   * EPC: 0xB0 - Operation Mode Setting
   * HomeKit: 0=OFF, 1=HEAT, 2=COOL, 3=AUTO
   * EchoNet-Lite: 0x41=Auto, 0x42=Cool, 0x43=Heat, 0x44=Dry, 0x45=Fan
   */
  async setOperationMode(device: AirConditionerDevice, mode: number): Promise<void> {
    let echoNetMode: number;
    
    // Convert HomeKit mode to EchoNet-Lite mode
    switch (mode) {
    case 1: echoNetMode = 0x43; break; // Heat
    case 2: echoNetMode = 0x42; break; // Cool  
    case 3: echoNetMode = 0x41; break; // Auto
    default: echoNetMode = 0x42; break; // Default to Cool for unknown modes
    }
    
    await this.setMetricValue(
      device,
      'b0',
      'operation mode',
      mode,
      () => [echoNetMode],
    );
    
    // Update local cache immediately after successful SET operation
    const hexValue = echoNetMode.toString(16);
    this.updateDeviceStateCache(device, 'b0', hexValue);
    
    // Also update HomeKit characteristics immediately to provide instant feedback
    this.updateHomeKitCharacteristicsAfterSet(device, 'b0', hexValue);
  }

  /**
   * Check if we should log unmatched response to prevent spam
   */
  private shouldLogUnmatchedResponse(deviceAddress: string): boolean {
    const now = Date.now();
    const lastLog = this.lastUnmatchedLogTime.get(deviceAddress) || 0;
    
    if (now - lastLog > this.unmatchedLogInterval) {
      this.lastUnmatchedLogTime.set(deviceAddress, now);
      return true;
    }
    return false;
  }

  /**
   * Get device state cache for accessory use (to avoid duplicate requests)
   */
  getDeviceStateCache(deviceKey: string): Record<string, string> | undefined {
    return this.deviceStateCache.get(deviceKey);
  }

  /**
   * Update device state cache for specific device and EPC
   */
  private updateDeviceStateCache(device: AirConditionerDevice, epc: string, value: string): void {
    const deviceKey = `${device.ip}_${device.eoj}`;
    const currentState = this.deviceStateCache.get(deviceKey) || {};
    currentState[epc] = value;
    this.deviceStateCache.set(deviceKey, currentState);
    // Only log cache updates in debug mode
    if (process.env.HOMEBRIDGE_DEBUG) {
      this.log.debug(`Updated cache for ${deviceKey} EPC ${epc}: ${value}`);
    }
  }

  /**
   * Update HomeKit characteristics immediately after SET operation
   */
  private updateHomeKitCharacteristicsAfterSet(device: AirConditionerDevice, epc: string, value: string): void {
    const deviceId = `${device.ip}_${device.eoj}`;
    
    // Find the corresponding accessory
    let targetAccessory = null;
    for (const [, accessory] of this.accessories) {
      if (accessory.context.device?.deviceId === deviceId) {
        targetAccessory = accessory;
        break;
      }
    }
    
    if (!targetAccessory) {
      this.log.debug(`No accessory found for device ${deviceId} during SET update`);
      return;
    }

    // Create a single property change object for this specific operation
    const changes: Record<string, string> = {};
    changes[epc] = value;
    
    this.log.info(`Immediate HomeKit update after SET operation for ${deviceId} EPC ${epc}: ${value}`);
    this.updateAccessoryCharacteristics(targetAccessory, changes);
  }

  /**
   * Handle device state change from external operations (INF notifications or polling)
   */
  private handleDeviceStateChange(ip: string, eoj: string, details: DeviceStateDetails): void {
    this.log.info(`External state change detected for ${ip}/${eoj}:`, details);
    
    const deviceId = `${ip}_${eoj}`;
    
    // Debug: List all registered accessories
    this.log.debug(`Looking for accessory with deviceId: ${deviceId}`);
    this.log.debug(`Currently registered accessories (${this.accessories.size}):`);
    for (const [uuid, accessory] of this.accessories) {
      const contextDevice = accessory.context.device;
      this.log.debug(`  UUID: ${uuid}, DeviceId: ${contextDevice?.deviceId}, IP: ${contextDevice?.ip}, EOJ: ${contextDevice?.eoj}`);
    }
    
    // Find the corresponding accessory
    let targetAccessory = null;
    for (const [, accessory] of this.accessories) {
      if (accessory.context.device?.deviceId === deviceId) {
        targetAccessory = accessory;
        break;
      }
    }
    
    if (!targetAccessory) {
      this.log.warn(`No accessory found for device ${deviceId}`);
      
      // Try alternative matching methods
      this.log.debug('Trying alternative matching methods...');
      for (const [uuid, accessory] of this.accessories) {
        const contextDevice = accessory.context.device;
        if (contextDevice?.ip === ip && contextDevice?.eoj === eoj) {
          this.log.info(`Found accessory using IP+EOJ matching: ${uuid}`);
          targetAccessory = accessory;
          break;
        }
        if (contextDevice?.ip === ip) {
          this.log.info(`Found accessory using IP-only matching: ${uuid} (EOJ mismatch: ${contextDevice?.eoj} vs ${eoj})`);
          targetAccessory = accessory;
          break;
        }
      }
      
      if (!targetAccessory) {
        this.log.error(`Still no accessory found for ${deviceId} after alternative matching`);
        return;
      }
    }
    
    // Update HomeKit characteristics based on changed properties
    this.updateAccessoryCharacteristics(targetAccessory, details, deviceId);
    
    // Schedule a comprehensive device state refresh after INF notification
    // This ensures we have the complete current state, not just the changed properties
    setTimeout(() => {
      this.refreshDeviceStateAfterINF(targetAccessory, deviceId, ip, eoj);
    }, 500); // Small delay to allow device to settle
  }

  /**
   * Update HomeKit characteristics when device state changes
   */
  private updateAccessoryCharacteristics(accessory: PlatformAccessory, details: DeviceStateDetails, deviceId?: string): void {
    const service = accessory.getService(this.Service.Thermostat);
    if (!service) {
      this.log.warn(`No Thermostat service found for accessory ${accessory.displayName}`);
      return;
    }

    this.log.info(`🔄 Updating HomeKit characteristics for ${accessory.displayName}`);

    // Process each changed property with enhanced reliability
    const updates: Array<() => void> = [];
    
    for (const [epc, value] of Object.entries(details)) {
      this.log.debug(`  Processing EPC ${epc}: ${value}`);
      
      switch (epc.toLowerCase()) {
      case '80': // Operation Status
        updates.push(() => this.updateOperationStatus(service, value as string));
        break;
      case 'b0': // Operation Mode
        updates.push(() => this.updateOperationMode(service, value as string, deviceId));
        break;
      case 'b3': // Target Temperature
        updates.push(() => this.updateTargetTemperature(service, value as string));
        break;
      case 'bb': // Current Temperature
        updates.push(() => this.updateCurrentTemperature(service, value as string));
        break;
      default:
        this.log.debug(`Unhandled EPC ${epc} with value ${value}`);
      }
    }

    // Execute all updates with proper timing
    updates.forEach((update, index) => {
      setTimeout(() => {
        try {
          update();
        } catch (error) {
          this.log.error(`Failed to update characteristic ${index}:`, error);
        }
      }, index * 50); // 50ms intervals between updates
    });

    // Schedule a verification after all updates
    setTimeout(() => {
      this.verifyHomeKitSync(accessory, details);
    }, updates.length * 50 + 100);

    // Ensure Active characteristic is properly synchronized
    setTimeout(() => {
      this.syncActiveCharacteristic(service, details);
    }, updates.length * 50 + 150);

    this.log.info(`✅ HomeKit characteristic updates scheduled for ${accessory.displayName}`);
  }

  /**
   * Update operation status characteristics
   */
  private updateOperationStatus(service: Service, value: string): void {
    if (!this.isValidEchoNetValue(value, '80')) {
      this.log.warn(`Invalid operation status value: 0x${value}, skipping update`);
      return;
    }
    
    const isOn = value === '30'; // 0x30 = ON
    this.log.info(`External operation status change: ${isOn ? 'ON' : 'OFF'}`);
    
    // Update both current and target heating cooling state (external change notification)
    const state = isOn ? 2 : 0; // Default to cooling when ON, OFF when not
    
    this.log.debug(`📱 Updating HomeKit operation status: CurrentState=${state}, TargetState=${state}`);
    
    // Primary update - use updateCharacteristic to ensure HomeKit app notification
    service.updateCharacteristic(this.Characteristic.CurrentHeatingCoolingState, state);
    service.updateCharacteristic(this.Characteristic.TargetHeatingCoolingState, state);
    // Update Active characteristic as well
    service.updateCharacteristic(this.Characteristic.Active, state > 0 ? 1 : 0);
    
    this.log.debug(`📱 HomeKit operation status updated: ${state} (Active: ${state > 0 ? 1 : 0})`);
  }

  /**
   * Update operation mode characteristics
   */
  private updateOperationMode(service: Service, value: string, deviceId?: string): void {
    if (!this.isValidEchoNetValue(value, 'b0')) {
      this.log.warn(`Invalid operation mode value: 0x${value}, skipping update`);
      return;
    }
    
    const mode = parseInt(value, 16);
    let homeKitMode = 0; // Default to OFF
    
    // Convert EchoNet-Lite mode to HomeKit mode
    switch (mode) {
    case 0x41: homeKitMode = 3; break; // Auto
    case 0x42: homeKitMode = 2; break; // Cool
    case 0x43: homeKitMode = 1; break; // Heat
    case 0x44: homeKitMode = 2; break; // Dry -> Cool
    case 0x45: homeKitMode = 2; break; // Fan -> Cool
    }
    
    this.log.info(`External operation mode change: ${homeKitMode} (EchoNet: 0x${mode.toString(16)})`);
    
    this.log.debug(`📱 Updating HomeKit operation mode: CurrentState=${homeKitMode}, TargetState=${homeKitMode}`);
    
    // Handle AUTO mode for CurrentHeatingCoolingState (doesn't support value 3)
    let currentMode = homeKitMode;
    if (homeKitMode === 3) { // AUTO mode
      // Get temperature data to determine actual heating/cooling state
      const deviceCache = deviceId ? this.getDeviceStateCache(deviceId) : null;
      
      if (deviceCache?.bb && deviceCache?.b3) {
        const currentTemp = parseInt(deviceCache.bb, 16);
        const targetTemp = parseInt(deviceCache.b3, 16);
        currentMode = (targetTemp > currentTemp) ? 1 : 2; // Heat : Cool
      } else {
        currentMode = 2; // Default to Cool if temperature data unavailable
      }
    }
    
    // Update using updateCharacteristic to ensure HomeKit app notification
    service.updateCharacteristic(this.Characteristic.CurrentHeatingCoolingState, currentMode);
    service.updateCharacteristic(this.Characteristic.TargetHeatingCoolingState, homeKitMode);
    
    this.log.debug(`📱 HomeKit operation mode updated: Current=${currentMode}, Target=${homeKitMode}`);
  }

  /**
   * Validate EchoNet-Lite data value
   */
  private isValidEchoNetValue(value: string, epc: string): boolean {
    const hexValue = parseInt(value, 16);
    
    // Check for EchoNet-Lite special values
    if (hexValue === 0xFD) {
      this.log.debug(`EPC ${epc}: Property value not set (0xFD)`);
      return false;
    }
    if (hexValue === 0xFE) {
      this.log.debug(`EPC ${epc}: Property value out of range (0xFE)`);
      return false;
    }
    if (hexValue === 0xFF) {
      this.log.debug(`EPC ${epc}: Property value undefined (0xFF)`);
      return false;
    }
    
    // EPC-specific validation
    switch (epc.toLowerCase()) {
    case 'b3': // Target temperature
      return hexValue >= 0 && hexValue <= 50; // Reasonable temperature range
    case 'bb': // Current temperature  
      return hexValue >= 0 && hexValue <= 125; // EchoNet-Lite temperature range
    case '80': // Operation status
      return hexValue === 0x30 || hexValue === 0x31; // ON or OFF only
    case 'b0': // Operation mode
      return [0x41, 0x42, 0x43, 0x44, 0x45].includes(hexValue); // Valid modes only
    default:
      return true; // Allow other EPCs
    }
  }

  /**
   * Clamp value to HomeKit valid range
   */
  private clampToHomeKitRange(value: number, characteristic: string): number {
    switch (characteristic) {
    case 'TargetTemperature':
      return Math.max(10, Math.min(38, value)); // HomeKit range: 10-38°C
    case 'CurrentTemperature':
      return Math.max(-270, Math.min(100, value)); // HomeKit range: -270-100°C
    default:
      return value;
    }
  }

  /**
   * Update target temperature characteristic
   */
  private updateTargetTemperature(service: Service, value: string): void {
    if (!this.isValidEchoNetValue(value, 'b3')) {
      this.log.warn(`Invalid target temperature value: 0x${value}, skipping update`);
      return;
    }
    
    const rawTemperature = parseInt(value, 16);
    const temperature = this.clampToHomeKitRange(rawTemperature, 'TargetTemperature');
    
    if (temperature !== rawTemperature) {
      this.log.warn(`Target temperature ${rawTemperature}°C clamped to ${temperature}°C (HomeKit range: 10-38°C)`);
    }
    
    this.log.info(`External target temperature change: ${temperature}°C`);
    
    this.log.debug(`📱 Updating HomeKit target temperature: ${temperature}°C`);
    
    // Update using updateCharacteristic to ensure HomeKit app notification
    service.updateCharacteristic(this.Characteristic.TargetTemperature, temperature);
    
    this.log.debug(`📱 HomeKit target temperature updated: ${temperature}°C`);
  }

  /**
   * Update current temperature characteristic
   */
  private updateCurrentTemperature(service: Service, value: string): void {
    if (!this.isValidEchoNetValue(value, 'bb')) {
      this.log.warn(`Invalid current temperature value: 0x${value}, skipping update`);
      return;
    }
    
    const temp = parseInt(value, 16);
    const rawTemperature = temp > 125 ? (temp - 256) : temp; // Handle negative temperatures
    const temperature = this.clampToHomeKitRange(rawTemperature, 'CurrentTemperature');
    
    if (temperature !== rawTemperature) {
      this.log.warn(`Current temperature ${rawTemperature}°C clamped to ${temperature}°C (HomeKit range: -270-100°C)`);
    }
    
    this.log.info(`External current temperature change: ${temperature}°C`);
    
    this.log.debug(`📱 Updating HomeKit current temperature: ${temperature}°C`);
    
    // Update using updateCharacteristic to ensure HomeKit app notification
    service.updateCharacteristic(this.Characteristic.CurrentTemperature, temperature);
    
    this.log.debug(`📱 HomeKit current temperature updated: ${temperature}°C`);
  }

  /**
   * Initialize device state from actual device to prevent showing default OFF status
   */
  private async initializeDeviceStateFromDevice(device: AirConditionerDevice): Promise<void> {
    this.log.info(`Initializing actual device state for ${device.ip}...`);
    
    try {
      // Use multi-request to get all initial states efficiently
      const stateProperties = ['80', 'b0', 'b3', 'bb']; // Operation status, mode, target temp, current temp
      const results = await this.sendEchoNetMultiRequest(device.ip, device.eoj, stateProperties);
      
      // Update cache with initial values
      const deviceKey = `${device.ip}_${device.eoj}`;
      const currentState = this.deviceStateCache.get(deviceKey) || {};
      
      for (const [epc, value] of Object.entries(results)) {
        if (this.isValidEchoNetValue(value, epc)) {
          currentState[epc] = value;
        }
      }
      
      this.deviceStateCache.set(deviceKey, currentState);
      
      // Immediately update HomeKit characteristics with actual device state
      if (Object.keys(currentState).length > 0) {
        this.log.info(`Initialized ${device.ip} with actual state: ${Object.keys(currentState).join(', ')}`);
        this.handleDeviceStateChange(device.ip, device.eoj, currentState);
      }
      
    } catch (error) {
      // If multi-request fails, try individual requests as fallback
      this.log.debug(`Multi-request initialization failed for ${device.ip}, trying individual requests`);
      await this.initializeDeviceStateIndividually(device);
    }
  }

  /**
   * Fallback initialization using individual requests
   */
  private async initializeDeviceStateIndividually(device: AirConditionerDevice): Promise<void> {
    const stateProperties = ['80', 'b0', 'b3', 'bb'];
    const deviceKey = `${device.ip}_${device.eoj}`;
    const currentState = this.deviceStateCache.get(deviceKey) || {};
    let initializedCount = 0;

    for (const epc of stateProperties) {
      try {
        const value = await this.sendEchoNetRequest(device.ip, device.eoj, epc);
        
        if (this.isValidEchoNetValue(value, epc)) {
          currentState[epc] = value;
          initializedCount++;
        }
        
        // Small delay between requests to avoid overwhelming device
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        this.log.debug(`Failed to initialize EPC ${epc} for ${device.ip}:`, error instanceof Error ? error.message : 'unknown error');
      }
    }

    if (initializedCount > 0) {
      this.deviceStateCache.set(deviceKey, currentState);
      this.log.info(`Individually initialized ${device.ip} with ${initializedCount} properties`);
      this.handleDeviceStateChange(device.ip, device.eoj, currentState);
    }
  }

  /**
   * Start polling for external state changes
   */
  private startPollingForDevice(device: AirConditionerDevice): void {
    if (!this.pollingConfig.enabled) {
      return;
    }

    const deviceKey = `${device.ip}_${device.eoj}`;
    
    // Clear existing timer if any
    const existingTimer = this.pollingTimers.get(deviceKey);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    // Start new polling timer
    const timer = setInterval(async () => {
      try {
        await this.pollDeviceState(device);
      } catch (error) {
        this.log.debug(`Polling error for ${device.ip}:`, error);
      }
    }, this.pollingConfig.intervalMs);

    this.pollingTimers.set(deviceKey, timer);
    this.log.debug(`Started polling for device ${deviceKey} every ${this.pollingConfig.intervalMs}ms`);
  }

  /**
   * Poll device state and detect changes using queue-based requests
   */
  private async pollDeviceState(device: AirConditionerDevice): Promise<void> {
    return new Promise((resolve) => {
      // Add polling operation to request queue for sequential processing
      this.requestQueue.push(async () => {
        try {
          await this.pollDeviceStateSequential(device);
        } catch (error) {
          this.log.debug(`Polling error for ${device.ip}:`, error);
        } finally {
          resolve();
        }
      });
      
      // Start processing queue if not already running
      this.processRequestQueue().catch(error => {
        this.log.error('Queue processing failed during polling:', error);
      });
    });
  }

  /**
   * Sequential polling implementation using multi-EPC requests to reduce TID usage
   */
  private async pollDeviceStateSequential(device: AirConditionerDevice): Promise<void> {
    const stateProperties = ['80', 'b0', 'b3', 'bb']; // Operation status, mode, target temp, current temp
    const deviceKey = `${device.ip}_${device.eoj}`;

    // Get cached state for comparison
    const currentState = this.deviceStateCache.get(deviceKey) || {};
    const changes: Record<string, string> = {};

    try {
      // Use multi-request to get all properties in one TID
      const results = await this.sendEchoNetMultiRequestDirect(device.ip, device.eoj, stateProperties);
      
      // Process all results
      for (const [epc, value] of Object.entries(results)) {
        if (value !== undefined && currentState[epc] !== value) {
          changes[epc] = value as string;
        }
        if (value !== undefined) {
          currentState[epc] = value as string;
        }
      }
      
      // Update the device state cache
      this.deviceStateCache.set(deviceKey, currentState);

      // Only trigger state change handling if there are actual changes
      if (Object.keys(changes).length > 0) {
        this.log.info(`Multi-polling detected ${Object.keys(changes).length} state changes for ${device.ip}: ${Object.keys(changes).join(', ')}`);
        this.handleDeviceStateChange(device.ip, device.eoj, changes);
      }
      
      // Log polling success occasionally (reduced frequency due to efficiency gain)
      if (Object.keys(results).length === stateProperties.length && this.shouldLogUnmatchedResponse(`${device.ip}_poll_success`)) {
        this.log.debug(`Multi-polling successful for ${device.ip} (${Object.keys(results).length}/${stateProperties.length} properties, 1 TID)`);
      }
      
    } catch (error) {
      // Fallback to individual requests if multi-request fails
      this.log.warn(`Multi-polling failed for ${device.ip}, falling back to individual requests:`, error instanceof Error ? error.message : 'unknown error');
      await this.pollDeviceStateSequentialFallback(device);
    }
  }

  /**
   * Fallback polling using individual requests (original method)
   */
  private async pollDeviceStateSequentialFallback(device: AirConditionerDevice): Promise<void> {
    const stateProperties = ['80', 'b0', 'b3', 'bb'];
    const deviceKey = `${device.ip}_${device.eoj}`;
    const currentState = this.deviceStateCache.get(deviceKey) || {};
    const changes: Record<string, string> = {};

    for (const epc of stateProperties) {
      try {
        const value = await this.sendEchoNetRequestDirect(device.ip, device.eoj, epc);
        
        if (currentState[epc] !== value) {
          changes[epc] = value;
        }
        currentState[epc] = value;
      } catch (error) {
        if (this.shouldLogUnmatchedResponse(`${device.ip}_fallback_error`)) {
          this.log.warn(`Fallback polling errors for ${device.ip}, check device connectivity`);
        }
      }
    }

    this.deviceStateCache.set(deviceKey, currentState);

    if (Object.keys(changes).length > 0) {
      this.log.info(`Fallback polling detected ${Object.keys(changes).length} state changes for ${device.ip}: ${Object.keys(changes).join(', ')}`);
      this.handleDeviceStateChange(device.ip, device.eoj, changes);
    }
  }

  /**
   * Stop polling for a device
   */
  private stopPollingForDevice(device: AirConditionerDevice): void {
    const deviceKey = `${device.ip}_${device.eoj}`;
    const timer = this.pollingTimers.get(deviceKey);
    
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(deviceKey);
      this.log.debug(`Stopped polling for device ${deviceKey}`);
    }
  }

  /**
   * Start monitoring INF notifications to detect potential issues
   */
  private startInfNotificationMonitoring(): void {
    // Check INF notification statistics every 5 minutes
    setInterval(() => {
      this.reportInfNotificationStatistics();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Report INF notification statistics for diagnostics
   */
  private reportInfNotificationStatistics(): void {
    if (this.infNotificationCount.size === 0) {
      this.log.debug('📊 INF Notification Statistics: No devices tracked yet');
      return;
    }

    this.log.info('📊 INF Notification Statistics:');
    
    for (const [deviceKey, count] of this.infNotificationCount.entries()) {
      const lastReceived = this.lastInfNotificationTime.get(deviceKey);
      const timeSinceLastInf = lastReceived ? Date.now() - lastReceived : null;
      
      if (timeSinceLastInf && timeSinceLastInf > 10 * 60 * 1000) { // More than 10 minutes
        this.log.warn(`  📵 Device ${deviceKey}: ${count} INF notifications, last received ${Math.round(timeSinceLastInf / 60000)} minutes ago`);
      } else {
        this.log.info(`  📶 Device ${deviceKey}: ${count} INF notifications, ` +
          `last received ${timeSinceLastInf ? Math.round(timeSinceLastInf / 1000) : 'never'} seconds ago`);
      }
    }
    
    // Suggest solutions if no INF notifications are being received
    const devicesWithoutRecentInf = Array.from(this.infNotificationCount.keys()).filter(deviceKey => {
      const lastReceived = this.lastInfNotificationTime.get(deviceKey);
      return !lastReceived || (Date.now() - lastReceived) > 15 * 60 * 1000; // 15 minutes
    });
    
    if (devicesWithoutRecentInf.length > 0) {
      this.log.warn('💡 Tip: Some devices are not sending INF notifications. This may be normal behavior for some devices.');
      this.log.warn('     External operations will still be detected via polling every', this.pollingConfig.intervalMs / 1000, 'seconds.');
    }
  }

  /**
   * Setup notification properties for a device to enable real-time external operation detection
   */
  private async setupNotificationProperties(device: AirConditionerDevice): Promise<void> {
    this.log.info(`🔔 Setting up INF notifications for ${device.deviceId}`);
    
    try {
      // First, get current notification property map (EPC: 0x9E)
      const currentNotificationMap = await this.getNotificationPropertyMap(device);
      
      // Properties we want to be notified about (operation state, mode, temperatures)
      const desiredNotificationEPCs = ['80', 'b0', 'b3', 'bb'];
      
      // Check if all desired EPCs are already in notification map (case-insensitive)
      const currentEPCsUpper = currentNotificationMap.map(epc => epc.toUpperCase());
      const missingEPCs = desiredNotificationEPCs.filter(epc => 
        !currentEPCsUpper.includes(epc.toUpperCase()),
      );
      
      if (missingEPCs.length === 0) {
        this.log.info(`✅ Device ${device.deviceId} already has all required notification properties configured`);
        return;
      }
      
      this.log.info(`🔧 Adding notification properties for ${device.deviceId}: ${missingEPCs.join(', ')}`);
      
      // Create new notification property map (remove duplicates case-insensitively)
      const allEPCs = [...currentNotificationMap, ...missingEPCs.map(epc => epc.toUpperCase())];
      const newNotificationEPCs = [...new Set(allEPCs.map(epc => epc.toUpperCase()))];
      
      // Set notification property map (EPC: 0x9E)
      await this.setNotificationPropertyMap(device, newNotificationEPCs);
      
      this.log.info(`✅ Successfully configured INF notifications for ${device.deviceId}`);
      
    } catch (error) {
      this.log.warn(`Failed to setup INF notifications for ${device.deviceId}:`, error instanceof Error ? error.message : 'unknown error');
      this.log.warn('External operations will be detected via polling instead');
    }
  }

  /**
   * Get current notification property map from device (EPC: 0x9E)
   */
  private async getNotificationPropertyMap(device: AirConditionerDevice): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const requestKey = `${device.ip}_${device.eoj}_9e_${Date.now()}`;
      
      // Store request for matching response
      this.pendingRequests.set(requestKey, {
        resolve: (response: unknown) => {
          const mapData = response as string;
          if (mapData && mapData.length >= 2) {
            // Parse property map: first byte is count, followed by EPC list
            const count = parseInt(mapData.substring(0, 2), 16);
            const epcs: string[] = [];
            
            for (let i = 0; i < count; i++) {
              const startPos = 2 + (i * 2);
              const endPos = startPos + 2;
              if (startPos < mapData.length) {
                epcs.push(mapData.substring(startPos, endPos));
              }
            }
            
            this.log.debug(`Current notification property map for ${device.deviceId}: ${epcs.join(', ')}`);
            resolve(epcs);
          } else {
            resolve([]); // Empty notification map
          }
        },
        reject,
        timestamp: Date.now(),
        ip: device.ip,
        eoj: device.eoj,
        epc: '9e',
      });
      
      // Send GET request for notification property map
      EL.sendOPC1(device.ip, [0x05, 0xff, 0x01], device.eoj, 0x62, '9e', []);
      
      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(requestKey)) {
          this.pendingRequests.delete(requestKey);
          reject(new Error(`Timeout getting notification property map from ${device.ip}`));
        }
      }, 3000);
    });
  }

  /**
   * Set notification property map for device (EPC: 0x9E)
   */
  private async setNotificationPropertyMap(device: AirConditionerDevice, epcs: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestKey = `${device.ip}_${device.eoj}_9e_set_${Date.now()}`;
      
      // Store request for matching response
      this.pendingRequests.set(requestKey, {
        resolve: () => resolve(),
        reject,
        timestamp: Date.now(),
        ip: device.ip,
        eoj: device.eoj,
        epc: '9e',
      });
      
      // Prepare data: count + EPC list
      const count = epcs.length;
      const data = [count, ...epcs.map(epc => parseInt(epc, 16))];
      
      this.log.debug(`Setting notification property map for ${device.deviceId}: ${epcs.join(', ')}`);
      
      // Send SET request for notification property map
      EL.sendOPC1(device.ip, [0x05, 0xff, 0x01], device.eoj, 0x61, '9e', data);
      
      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(requestKey)) {
          this.pendingRequests.delete(requestKey);
          reject(new Error(`Timeout setting notification property map on ${device.ip}`));
        }
      }, 3000);
    });
  }

  /**
   * Verify HomeKit synchronization after updates
   */
  private verifyHomeKitSync(accessory: PlatformAccessory, expectedDetails: DeviceStateDetails): void {
    const service = accessory.getService(this.Service.Thermostat);
    if (!service) {
      return;
    }

    this.log.debug(`🔍 Verifying HomeKit sync for ${accessory.displayName}`);
    
    let syncIssues = 0;
    
    // Check operation status sync
    if (expectedDetails['80']) {
      const expectedState = expectedDetails['80'] === '30' ? 2 : 0;
      const currentState = service.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState).value;
      const targetState = service.getCharacteristic(this.Characteristic.TargetHeatingCoolingState).value;
      
      if (currentState !== expectedState || targetState !== expectedState) {
        this.log.warn(`❌ HomeKit sync issue - Operation State: expected=${expectedState}, current=${currentState}, target=${targetState}`);
        // Force resync using updateCharacteristic
        service.updateCharacteristic(this.Characteristic.CurrentHeatingCoolingState, expectedState);
        service.updateCharacteristic(this.Characteristic.TargetHeatingCoolingState, expectedState);
        service.updateCharacteristic(this.Characteristic.Active, expectedState > 0 ? 1 : 0);
        syncIssues++;
      }
    }
    
    // Check temperature sync
    if (expectedDetails.b3) {
      if (!this.isValidEchoNetValue(expectedDetails.b3, 'b3')) {
        this.log.debug(`Skipping temperature sync due to invalid EchoNet-Lite value: 0x${expectedDetails.b3}`);
        return;
      }
      
      const rawTemp = parseInt(expectedDetails.b3, 16);
      const expectedTemp = this.clampToHomeKitRange(rawTemp, 'TargetTemperature');
      const currentTemp = service.getCharacteristic(this.Characteristic.TargetTemperature).value as number;
      
      if (rawTemp !== expectedTemp) {
        this.log.warn(`Target temperature ${rawTemp}°C is invalid (EchoNet special value or out of range), skipping sync`);
        return;
      }
      
      if (Math.abs(currentTemp - expectedTemp) > 0.5) {
        this.log.warn(`❌ HomeKit sync issue - Target Temperature: expected=${expectedTemp}°C, current=${currentTemp}°C`);
        service.updateCharacteristic(this.Characteristic.TargetTemperature, expectedTemp);
        syncIssues++;
      }
    }
    
    // Check current temperature sync
    if (expectedDetails.bb) {
      if (!this.isValidEchoNetValue(expectedDetails.bb, 'bb')) {
        this.log.debug(`Skipping current temperature sync due to invalid EchoNet-Lite value: 0x${expectedDetails.bb}`);
      } else {
        const rawTemp = parseInt(expectedDetails.bb, 16);
        const expectedTemp = this.clampToHomeKitRange(rawTemp, 'CurrentTemperature');
        const currentTemp = service.getCharacteristic(this.Characteristic.CurrentTemperature).value as number;
        
        if (rawTemp !== expectedTemp) {
          this.log.warn(`Current temperature ${rawTemp}°C is invalid (EchoNet special value or out of range), skipping sync`);
        } else if (Math.abs(currentTemp - expectedTemp) > 0.5) {
          this.log.warn(`❌ HomeKit sync issue - Current Temperature: expected=${expectedTemp}°C, current=${currentTemp}°C`);
          service.updateCharacteristic(this.Characteristic.CurrentTemperature, expectedTemp);
          syncIssues++;
        }
      }
    }
    
    if (syncIssues === 0) {
      this.log.debug(`✅ HomeKit sync verified for ${accessory.displayName}`);
    } else {
      this.log.warn(`⚠️  HomeKit sync corrected ${syncIssues} issues for ${accessory.displayName}`);
    }
  }

  /**
   * Synchronize Active characteristic based on current state
   */
  private syncActiveCharacteristic(service: Service, details: DeviceStateDetails): void {
    try {
      const activeChar = service.getCharacteristic(this.Characteristic.Active);
      
      // Determine active state from operation status or heating/cooling state
      let shouldBeActive = false;
      
      if (details['80']) {
        shouldBeActive = details['80'] === '30'; // 0x30 = ON
      } else {
        // Fallback: check current heating/cooling state
        const currentState = service.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState).value as number;
        const targetState = service.getCharacteristic(this.Characteristic.TargetHeatingCoolingState).value as number;
        shouldBeActive = currentState > 0 || targetState > 0;
      }
      
      const expectedActiveValue = shouldBeActive ? 1 : 0;
      const currentActiveValue = activeChar.value as number;
      
      if (currentActiveValue !== expectedActiveValue) {
        this.log.info(`🔄 Syncing Active characteristic: ${currentActiveValue} -> ${expectedActiveValue}`);
        service.updateCharacteristic(this.Characteristic.Active, expectedActiveValue);
      } else {
        this.log.debug(`✅ Active characteristic already in sync: ${expectedActiveValue}`);
      }
      
    } catch (error) {
      this.log.warn('Failed to sync Active characteristic:', error instanceof Error ? error.message : 'unknown error');
    }
  }

  /**
   * Refresh complete device state after INF notification
   * This ensures we have accurate current state, not just the changed properties
   */
  private async refreshDeviceStateAfterINF(accessory: PlatformAccessory, deviceId: string, ip: string, eoj: string): Promise<void> {
    try {
      this.log.debug(`🔄 Refreshing complete device state after INF for ${accessory.displayName}`);
      
      // Fetch complete current state by polling device
      const stateData: Record<string, string> = {};
      
      try {
        // Get operation status
        const operationStatus = await this.sendEchoNetRequest(ip, eoj, '80');
        stateData['80'] = operationStatus;
        
        // Get operation mode
        const operationMode = await this.sendEchoNetRequest(ip, eoj, 'b0');
        // eslint-disable-next-line dot-notation
        stateData['b0'] = operationMode;
        
        // Get target temperature (may fail for some modes)
        try {
          const targetTemp = await this.sendEchoNetRequest(ip, eoj, 'b3');
          // eslint-disable-next-line dot-notation
          stateData['b3'] = targetTemp;
        } catch {
          // Target temperature may not be available in some modes
        }
        
        // Get current temperature
        try {
          const currentTemp = await this.sendEchoNetRequest(ip, eoj, 'bb');
          // eslint-disable-next-line dot-notation
          stateData['bb'] = currentTemp;
        } catch {
          // Current temperature may not be available
        }
        
      } catch (error) {
        this.log.warn(`Failed to fetch complete state for ${accessory.displayName}:`, error instanceof Error ? error.message : 'unknown error');
        return;
      }
      
      if (Object.keys(stateData).length > 0) {
        // Update device state cache with fresh data
        const deviceData = { ip, eoj, deviceId };
        Object.entries(stateData).forEach(([epc, value]) => {
          this.updateDeviceStateCache(deviceData, epc, value);
        });
        
        this.log.info(`✅ Refreshed complete state for ${accessory.displayName} after INF: ${JSON.stringify(stateData)}`);
        
        // Update HomeKit characteristics with complete fresh state
        this.updateAccessoryCharacteristics(accessory, stateData, deviceId);
        
        // Verify sync after refresh
        setTimeout(() => {
          this.verifyHomeKitSync(accessory, stateData);
        }, 200);
        
      } else {
        this.log.warn(`⚠️  Failed to refresh complete state for ${accessory.displayName} after INF`);
      }
      
    } catch (error) {
      this.log.warn(`Failed to refresh device state after INF for ${accessory.displayName}:`, error instanceof Error ? error.message : 'unknown error');
    }
  }


  /**
   * Get manufacturer name from EchoNet-Lite manufacturer code
   */
  getManufacturerName(manufacturerCode: string): string {
    const manufacturer = MANUFACTURER_CODES[manufacturerCode.toLowerCase()];
    return manufacturer || UNKNOWN_MANUFACTURER;
  }

  /**
   * Get manufacturer code from device
   * EPC: 0x8A - Manufacturer Code
   */
  async getManufacturerCode(device: AirConditionerDevice): Promise<string> {
    try {
      const response = await this.sendEchoNetRequest(device.ip, device.eoj, '8a');
      this.log.debug(`Manufacturer code for ${device.ip}: 0x${response}`);
      return response;
    } catch (error) {
      this.log.warn(`Failed to get manufacturer code for ${device.ip}:`, error instanceof Error ? error.message : 'unknown error');
      return '000000'; // Unknown manufacturer code
    }
  }
}
