import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { EchoNetLiteAirconPlatform } from './platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class AirConditionerAccessory {
  private service: Service;

  /**
   * Air conditioner states (initialized with reasonable defaults, will be updated with actual device state)
   */
  private airconStates = {
    Active: false, // Will be updated from device
    CurrentTemperature: 20, // Reasonable default
    TargetTemperature: 24, // More reasonable default for AC
    CurrentHeatingCoolingState: 0, // Will be updated from device
    TargetHeatingCoolingState: 0, // Will be updated from device
  };

  // Track if initial state has been loaded from device
  private hasLoadedInitialState = false;

  // Cache for reducing redundant requests
  private lastUpdateTime = {
    operationState: 0,
    currentTemperature: 0,
    targetTemperature: 0,
    operationMode: 0,
  };
  private cacheTimeout = 2000; // 2 seconds cache for Homebridge compatibility

  constructor(
    private readonly platform: EchoNetLiteAirconPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    const device = accessory.context.device;
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, device.manufacturer || 'EchoNet-Lite')
      .setCharacteristic(this.platform.Characteristic.Model, device.model || 'Air Conditioner')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.serialNumber || device.deviceId);

    // get the Thermostat service if it exists, otherwise create a new Thermostat service
    this.service = this.accessory.getService(this.platform.Service.Thermostat) || 
                  this.accessory.addService(this.platform.Service.Thermostat);

    // set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    // register handlers for the thermostat characteristics
    
    // Current Heating Cooling State (read-only)
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    // Target Heating Cooling State
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onSet(this.setTargetHeatingCoolingState.bind(this))
      .onGet(this.getTargetHeatingCoolingState.bind(this));

    // Current Temperature (read-only)
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    // Target Temperature
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(this.getTargetTemperature.bind(this));

    // Request initial state load in background to prevent showing default OFF status
    this.loadInitialStateFromDevice();
  }

  /**
   * Load initial state from device to prevent showing default OFF status
   */
  private loadInitialStateFromDevice(): void {
    if (this.hasLoadedInitialState) {
      return;
    }

    // Small delay to allow platform initialization to complete
    setTimeout(async () => {
      try {
        const device = this.accessory.context.device;
        this.platform.log.debug(`Loading initial state for accessory ${this.accessory.displayName}`);
        
        // Try to get current states with short timeout
        const statePromises = [
          this.getOperationStateAndMode(device).catch(() => ({ isOn: false, mode: 0 })),
          this.platform.getCurrentTemperature(device).catch(() => 20),
          this.platform.getTargetTemperature(device).catch(() => 24),
        ];
        
        const [operationState, currentTemp, targetTemp] = await Promise.allSettled(statePromises);
        
        let stateUpdated = false;
        
        // Update operation state if successful
        if (operationState.status === 'fulfilled') {
          const opState = operationState.value;
          if (typeof opState === 'object' && 'isOn' in opState && 'mode' in opState) {
            const { isOn, mode } = opState;
            if (mode > 0 || isOn) { // Only update if we got meaningful data
              this.airconStates.TargetHeatingCoolingState = isOn ? mode : 0;
              this.airconStates.CurrentHeatingCoolingState = isOn ? mode : 0;
              stateUpdated = true;
              this.platform.log.debug(`Loaded operation state for ${this.accessory.displayName}: ${isOn ? 'ON' : 'OFF'}, mode: ${mode}`);
            }
          }
        }
        
        // Update temperatures if successful
        if (currentTemp.status === 'fulfilled' && typeof currentTemp.value === 'number') {
          this.airconStates.CurrentTemperature = currentTemp.value;
          stateUpdated = true;
        }
        
        if (targetTemp.status === 'fulfilled' && typeof targetTemp.value === 'number') {
          this.airconStates.TargetTemperature = targetTemp.value;
          stateUpdated = true;
        }
        
        if (stateUpdated) {
          this.hasLoadedInitialState = true;
          this.platform.log.info(`Successfully loaded initial state for ${this.accessory.displayName}`);
          
          // Update HomeKit characteristics with loaded state
          this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.airconStates.CurrentHeatingCoolingState);
          this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.airconStates.TargetHeatingCoolingState);
          this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.airconStates.CurrentTemperature);
          this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.airconStates.TargetTemperature);
        }
        
      } catch (error) {
        this.platform.log.debug(`Failed to load initial state for ${this.accessory.displayName}:`, error instanceof Error ? error.message : 'unknown error');
      }
    }, 1000); // 1 second delay to allow initialization
  }

  /**
   * Handle "SET" requests for Target Heating Cooling State
   */
  async setTargetHeatingCoolingState(value: CharacteristicValue) {
    const state = value as number;
    this.airconStates.TargetHeatingCoolingState = state;
    this.platform.log.debug('Set Target Heating Cooling State ->', state);

    try {
      const device = this.accessory.context.device;
      
      if (state === 0) {
        // Turn OFF
        await this.platform.setOperationState(device, false);
        this.platform.log.debug('Air conditioner turned OFF');
      } else {
        // Turn ON and set mode (1=HEAT, 2=COOL, 3=AUTO)
        await this.platform.setOperationState(device, true);
        await this.platform.setOperationMode(device, state);
        this.platform.log.debug(`Air conditioner turned ON with mode ${state}`);
      }
      
      // Update cache timestamps
      this.lastUpdateTime.operationState = Date.now();
      this.lastUpdateTime.operationMode = Date.now();
      
      // Immediately update CurrentHeatingCoolingState to reflect the change
      this.airconStates.CurrentHeatingCoolingState = state;
      
      // Notify HomeKit of the state change immediately
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, state);
      this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, state);
      
      this.platform.log.debug(`HomeKit characteristics updated immediately: Current=${state}, Target=${state}`);
      
      // Schedule a verification check after a short delay to ensure device state matches
      setTimeout(() => {
        this.verifyOperationStateChange(device, state);
      }, 2000); // Verify after 2 seconds
      
    } catch (error) {
      this.platform.log.error('Failed to set heating/cooling state:', error);
      // Revert state on error
      this.airconStates.TargetHeatingCoolingState = state === 0 ? 1 : 0;
      throw error;
    }
  }

  /**
   * Get operation state and mode with caching (optimized to avoid duplicate requests)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getOperationStateAndMode(device: any): Promise<{ isOn: boolean; mode: number }> {
    // Return cached values if still valid
    if (this.isCacheValid('operationState') && this.isCacheValid('operationMode')) {
      return {
        isOn: this.airconStates.TargetHeatingCoolingState > 0,
        mode: this.airconStates.TargetHeatingCoolingState,
      };
    }

    // Try to use platform-level cache first (from multi-EPC requests)
    const deviceKey = `${device.ip}_${device.eoj}`;
    const platformCache = this.platform.getDeviceStateCache(deviceKey);
    
    // eslint-disable-next-line dot-notation
    if (platformCache && platformCache['80'] && platformCache['b0']) {
      // Use cached data from platform (from multi-EPC requests)
      // eslint-disable-next-line dot-notation
      const isOn = platformCache['80'] === '30';
      let mode = 0;
      
      if (isOn) {
        // eslint-disable-next-line dot-notation
        const epcMode = parseInt(platformCache['b0'], 16);
        // Convert EchoNet-Lite mode to HomeKit mode
        switch (epcMode) {
        case 0x41: mode = 3; break; // Auto
        case 0x42: mode = 2; break; // Cool
        case 0x43: mode = 1; break; // Heat
        case 0x44: mode = 2; break; // Dry -> Cool
        case 0x45: mode = 2; break; // Fan -> Cool
        default: mode = 2; break;   // Default to Cool
        }
      }
      
      // Update local cache timestamps to prevent immediate re-fetch
      this.lastUpdateTime.operationState = Date.now();
      this.lastUpdateTime.operationMode = Date.now();
      
      // Update local state cache
      this.airconStates.TargetHeatingCoolingState = isOn ? mode : 0;
      this.airconStates.CurrentHeatingCoolingState = isOn ? mode : 0;
      
      this.platform.log.debug(`Using platform cache for ${this.accessory.displayName}: ${isOn ? 'ON' : 'OFF'}, mode: ${mode}`);
      return { isOn, mode };
    }

    // Fallback to individual requests only if platform cache is not available
    this.platform.log.debug(`Platform cache unavailable for ${this.accessory.displayName}, using individual requests`);
    
    const isOn = await this.platform.getOperationState(device);
    this.lastUpdateTime.operationState = Date.now();
    
    let mode = 0;
    if (isOn) {
      mode = await this.platform.getOperationMode(device);
      this.lastUpdateTime.operationMode = Date.now();
    }
    
    return { isOn, mode };
  }

  /**
   * Handle "GET" requests for Target Heating Cooling State
   */
  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    // Return cached value immediately if available
    const cachedValue = this.airconStates.TargetHeatingCoolingState;
    
    try {
      const device = this.accessory.context.device;
      
      // Quick check with timeout
      const result = await Promise.race([
        this.getOperationStateAndMode(device),
        new Promise<{ isOn: boolean; mode: number }>((_, reject) => 
          setTimeout(() => reject(new Error('Quick timeout')), 800),
        ),
      ]);
      
      const state = result.isOn ? result.mode : 0;
      this.airconStates.TargetHeatingCoolingState = state;
      this.platform.log.debug('Get Target Heating Cooling State (fresh) ->', state);
      return state;
      
    } catch (error) {
      this.platform.log.debug('Using cached target state due to:', error instanceof Error ? error.message : 'unknown error');
      return cachedValue;
    }
  }

  /**
   * Handle "GET" requests for Current Heating Cooling State
   */
  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    // Return cached value immediately if available
    const cachedValue = this.airconStates.CurrentHeatingCoolingState;
    
    try {
      const device = this.accessory.context.device;
      
      // Quick check with timeout
      const result = await Promise.race([
        this.getOperationStateAndMode(device),
        new Promise<{ isOn: boolean; mode: number }>((_, reject) => 
          setTimeout(() => reject(new Error('Quick timeout')), 800),
        ),
      ]);
      
      const state = result.isOn ? result.mode : 0;
      this.airconStates.CurrentHeatingCoolingState = state;
      this.platform.log.debug('Get Current Heating Cooling State (fresh) ->', state);
      return state;
      
    } catch (error) {
      this.platform.log.debug('Using cached current state due to:', error instanceof Error ? error.message : 'unknown error');
      return cachedValue;
    }
  }

  /**
   * Handle "SET" requests for Target Temperature
   */
  async setTargetTemperature(value: CharacteristicValue) {
    const temperature = value as number;
    this.airconStates.TargetTemperature = temperature;
    this.platform.log.debug('Set Target Temperature ->', temperature);

    try {
      const device = this.accessory.context.device;
      
      // Validate temperature range (typical range for air conditioners)
      const clampedTemp = Math.max(16, Math.min(30, Math.round(temperature)));
      if (clampedTemp !== temperature) {
        this.platform.log.warn(`Temperature ${temperature} clamped to ${clampedTemp} (valid range: 16-30°C)`);
        this.airconStates.TargetTemperature = clampedTemp;
      }
      
      await this.platform.setTargetTemperature(device, clampedTemp);
      this.platform.log.debug(`Target temperature set to ${clampedTemp}°C`);
      
      // Update cache timestamp
      this.lastUpdateTime.targetTemperature = Date.now();
      
      // Immediately update HomeKit characteristic to reflect the change
      this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, clampedTemp);
      
      this.platform.log.debug(`HomeKit target temperature characteristic updated immediately: ${clampedTemp}°C`);
      
      // Schedule a verification check after a short delay to ensure device state matches
      setTimeout(() => {
        this.verifyTargetTemperatureChange(device, clampedTemp);
      }, 2000); // Verify after 2 seconds
      
    } catch (error) {
      this.platform.log.error('Failed to set target temperature:', error);
      // Keep the previous temperature value on error
      throw error;
    }
  }

  /**
   * Handle "GET" requests for Target Temperature
   */
  async getTargetTemperature(): Promise<CharacteristicValue> {
    // Return cached value if still valid
    if (this.isCacheValid('targetTemperature')) {
      this.platform.log.debug('Get Target Temperature (cached) ->', this.airconStates.TargetTemperature);
      return this.airconStates.TargetTemperature;
    }

    // Try to use platform-level cache first (from multi-EPC requests)
    const device = this.accessory.context.device;
    const deviceKey = `${device.ip}_${device.eoj}`;
    const platformCache = this.platform.getDeviceStateCache(deviceKey);
    
    // eslint-disable-next-line dot-notation
    if (platformCache && platformCache['b3']) {
      // eslint-disable-next-line dot-notation
      const targetTempHex = platformCache['b3'];
      if (targetTempHex !== 'fd') { // Not "property not set"
        const temp = parseInt(targetTempHex, 16);
        
        // Update local cache timestamps to prevent immediate re-fetch
        this.lastUpdateTime.targetTemperature = Date.now();
        this.airconStates.TargetTemperature = temp;
        
        this.platform.log.debug(`Using platform cache for target temperature: ${temp}°C`);
        return temp;
      }
    }

    const cachedValue = this.airconStates.TargetTemperature;
    
    // Fallback to individual request only if platform cache is not available
    try {
      this.platform.log.debug('Platform cache unavailable for target temperature, using individual request');
      
      // Quick fetch with timeout
      const temp = await Promise.race([
        this.platform.getTargetTemperature(device),
        new Promise<number>((_, reject) => 
          setTimeout(() => reject(new Error('Quick timeout')), 1000),
        ),
      ]);
      
      this.airconStates.TargetTemperature = temp;
      this.lastUpdateTime.targetTemperature = Date.now();
      this.platform.log.debug('Get Target Temperature (fresh) ->', temp);
      return temp;
      
    } catch (error) {
      this.platform.log.debug('Using cached target temperature due to:', error instanceof Error ? error.message : 'unknown error');
      return cachedValue;
    }
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(cacheKey: keyof typeof this.lastUpdateTime): boolean {
    return (Date.now() - this.lastUpdateTime[cacheKey]) < this.cacheTimeout;
  }

  /**
   * Handle "GET" requests for Current Temperature
   */
  async getCurrentTemperature(): Promise<CharacteristicValue> {
    // Return cached value if still valid
    if (this.isCacheValid('currentTemperature')) {
      this.platform.log.debug('Get Current Temperature (cached) ->', this.airconStates.CurrentTemperature);
      return this.airconStates.CurrentTemperature;
    }

    // Try to use platform-level cache first (from multi-EPC requests)
    const device = this.accessory.context.device;
    const deviceKey = `${device.ip}_${device.eoj}`;
    const platformCache = this.platform.getDeviceStateCache(deviceKey);
    
    // eslint-disable-next-line dot-notation
    if (platformCache && platformCache['bb']) {
      // eslint-disable-next-line dot-notation
      const currentTempHex = platformCache['bb'];
      if (currentTempHex !== 'fd') { // Not "property not set"
        const temp = parseInt(currentTempHex, 16);
        
        // Update local cache timestamps to prevent immediate re-fetch
        this.lastUpdateTime.currentTemperature = Date.now();
        this.airconStates.CurrentTemperature = temp;
        
        this.platform.log.debug(`Using platform cache for current temperature: ${temp}°C`);
        return temp;
      }
    }

    // For Homebridge compatibility, start with cached value and update in background
    const cachedValue = this.airconStates.CurrentTemperature;
    
    // Fallback to individual request only if platform cache is not available
    try {
      this.platform.log.debug('Platform cache unavailable for current temperature, using individual request');
      
      // Use a shorter timeout and return cached value if it takes too long
      const freshData = await Promise.race([
        this.platform.getCurrentTemperature(device),
        new Promise<number>((_, reject) => 
          setTimeout(() => reject(new Error('Quick timeout')), 1000),
        ),
      ]);
      
      this.airconStates.CurrentTemperature = freshData;
      this.lastUpdateTime.currentTemperature = Date.now();
      this.platform.log.debug('Get Current Temperature (fresh) ->', freshData);
      return freshData;
      
    } catch (error) {
      this.platform.log.debug('Using cached temperature due to:', error instanceof Error ? error.message : 'unknown error');
      // Update in background for next time
      this.updateTemperatureInBackground();
      return cachedValue;
    }
  }

  /**
   * Update temperature in background without blocking
   */
  private updateTemperatureInBackground(): void {
    const device = this.accessory.context.device;
    this.platform.getCurrentTemperature(device)
      .then(temp => {
        this.airconStates.CurrentTemperature = temp;
        this.lastUpdateTime.currentTemperature = Date.now();
        this.platform.log.debug('Background temperature update:', temp);
      })
      .catch(error => {
        this.platform.log.debug('Background temperature update failed:', error instanceof Error ? error.message : 'unknown error');
      });
  }

  /**
   * Verify operation state change after SET operation
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async verifyOperationStateChange(device: any, expectedState: number): Promise<void> {
    try {
      const result = await this.getOperationStateAndMode(device);
      const actualState = result.isOn ? result.mode : 0;
      
      if (actualState !== expectedState) {
        this.platform.log.warn(`Operation state mismatch detected! Expected: ${expectedState}, Actual: ${actualState}`);
        
        // Update with actual device state
        this.airconStates.TargetHeatingCoolingState = actualState;
        this.airconStates.CurrentHeatingCoolingState = actualState;
        
        // Notify HomeKit of the corrected state (external device state correction)
        this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(actualState);
        this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).updateValue(actualState);
        
        this.platform.log.debug(`HomeKit characteristics corrected to actual device state: ${actualState}`);
      } else {
        this.platform.log.debug(`Operation state verification successful: ${expectedState}`);
      }
    } catch (error) {
      this.platform.log.debug(`Operation state verification failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  /**
   * Verify target temperature change after SET operation
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async verifyTargetTemperatureChange(device: any, expectedTemp: number): Promise<void> {
    try {
      const actualTemp = await this.platform.getTargetTemperature(device);
      
      if (Math.abs(actualTemp - expectedTemp) > 0.5) { // Allow 0.5°C tolerance
        this.platform.log.warn(`Target temperature mismatch detected! Expected: ${expectedTemp}°C, Actual: ${actualTemp}°C`);
        
        // Update with actual device state
        this.airconStates.TargetTemperature = actualTemp;
        
        // Notify HomeKit of the corrected temperature (external device state correction)
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).updateValue(actualTemp);
        
        this.platform.log.debug(`HomeKit target temperature corrected to actual device state: ${actualTemp}°C`);
      } else {
        this.platform.log.debug(`Target temperature verification successful: ${expectedTemp}°C`);
      }
    } catch (error) {
      this.platform.log.debug(`Target temperature verification failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}
