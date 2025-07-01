import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EchonetLiteAirconPlatform } from './platform.js';
import { promisify } from 'util';
import { JobQueue } from './jobQueue.js';
import { EchonetPropertyResponse, EchonetNotification, EchonetSetPropertyValue, PropertyCache, CacheEntry } from './types.js';
import { getManufacturerName } from './manufacturerCodes.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class EchonetLiteAirconAccessory {
  private readonly service: Service;

  private readonly address: string;
  private readonly eoj: number[];
  private isActive = false; // power on: true, off: false
  private readonly jobQueue: JobQueue = new JobQueue();
  private readonly propertyCache: PropertyCache = {};

  // Cache TTL settings (in milliseconds)
  private readonly cacheTTL = {
    temperature: 5000,     // 5 seconds for temperature readings
    thresholdTemp: 10000,  // 10 seconds for threshold temperatures
    status: 2000,          // 2 seconds for status
    mode: 3000,           // 3 seconds for mode
  };

  constructor(
    private readonly platform: EchonetLiteAirconPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.address = accessory.context.address;
    this.eoj = accessory.context.eoj;

    // Set accessory information using manufacturer code if available
    const manufacturerName = accessory.context.manufacturerCode
      ? getManufacturerName(accessory.context.manufacturerCode)
      : 'Unknown';

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, manufacturerName)
      .setCharacteristic(this.platform.Characteristic.Model, 'Echonet Lite Air Conditioner')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.address);

    // get the HeaterCooler service if it exists, otherwise create a new HeaterCooler service
    this.service = this.accessory.getService(this.platform.Service.HeaterCooler)
      || this.accessory.addService(this.platform.Service.HeaterCooler);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'エアコン');

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.handleCurrentHeaterCoolerStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onGet(this.handleTargetHeaterCoolerStateGet.bind(this))
      .onSet(this.handleTargetHeaterCoolerStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({minValue: -127, maxValue: 125, minStep: 1})
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .setProps({minValue: 16, maxValue: 30, minStep: 1})
      .onGet(this.handleCoolingThresholdTemperatureGet.bind(this))
      .onSet(this.handleCoolingThresholdTemperatureSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .setProps({minValue: 16, maxValue: 30, minStep: 1})
      .onGet(this.handleHeatingThresholdTemperatureGet.bind(this))
      .onSet(this.handleHeatingThresholdTemperatureSet.bind(this));

    this.platform.el.on('notify', this.updateStates.bind(this));

  }

  /**
   * Handle requests to get the current value of the "Active" characteristic
   */
  async handleActiveGet(): Promise<boolean> {
    this.platform.log.debug('Triggered GET Active');

    let currentValue = false;

    try {
      const res = await this.getPropertyValueWithCache(this.address, this.eoj, 0x80, this.cacheTTL.status);
      const status = res.message.data.status;
      currentValue = status ?? false;
      this.isActive = currentValue;
    } catch (err) {
      currentValue = this.isActive;
      if (err instanceof Error) {
        this.platform.log.error('Failed to get Active status:', err.message);
      } else {
        this.platform.log.error('Failed to get Active status:', String(err));
      }
    }
    return currentValue;
  }

  /**
   * Handle requests to set the "Active" characteristic
   */
  handleActiveSet(value: CharacteristicValue): void {
    this.platform.log.debug('Triggered SET Active:', value);

    try {
      const isActive = value !== 0;
      this.setPropertyValue(this.address, this.eoj, 0x80, { status: isActive });
      this.isActive = isActive;
    } catch (err) {
      if (err instanceof Error) {
        this.platform.log.error('Failed to set Active status:', err.message);
      } else {
        this.platform.log.error('Failed to set Active status:', String(err));
      }
    }
  }

  /**
   * Handle requests to get the current value of the "Current Heater-Cooler State" characteristic
   */
  async handleCurrentHeaterCoolerStateGet(): Promise<number> {
    this.platform.log.debug('Triggered GET CurrentHeaterCoolerState');

    let currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;

    if (this.isActive) {
      try {
        const res = await this.getPropertyValueWithCache(this.address, this.eoj, 0xB0, this.cacheTTL.mode);
        const mode = res.message.data.mode;
        currentValue = mode === 2
          ? this.platform.Characteristic.CurrentHeaterCoolerState.COOLING
          : this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
      } catch (err) {
        if (err instanceof Error) {
          this.platform.log.error('Failed to get current heater-cooler state:', err.message);
        } else {
          this.platform.log.error('Failed to get current heater-cooler state:', String(err));
        }
        currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
      }
    }
    return currentValue;
  }

  /**
   * Handle requests to get the current value of the "Target Heater-Cooler State" characteristic
   */
  async handleTargetHeaterCoolerStateGet(): Promise<number> {
    this.platform.log.debug('Triggered GET TargetHeaterCoolerState');

    let currentValue = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;

    if (this.isActive) {
      try {
        const res = await this.getPropertyValueWithCache(this.address, this.eoj, 0xB0, this.cacheTTL.mode);
        const mode = res.message.data.mode;
        if (mode === 2) {
          currentValue = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
        } else if (mode === 3) {
          currentValue = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
        } else {
          currentValue = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
        }
      } catch (err) {
        if (err instanceof Error) {
          this.platform.log.error('Failed to get target heater-cooler state:', err.message);
        } else {
          this.platform.log.error('Failed to get target heater-cooler state:', String(err));
        }
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
      }
    }

    return currentValue;
  }

  /**
   * Handle requests to set the "Target Heater-Cooler State" characteristic
   */
  async handleTargetHeaterCoolerStateSet(value: CharacteristicValue): Promise<void> {
    this.platform.log.debug('Triggered SET TargetHeaterCoolerState:', value);

    let mode = 1; // AUTO
    if (value === this.platform.Characteristic.TargetHeaterCoolerState.COOL) {
      mode = 2; // COOLER
    } else if (value === this.platform.Characteristic.TargetHeaterCoolerState.HEAT) {
      mode = 3; // HEATER
    }

    try {
      await this.setPropertyValue(this.address, this.eoj, 0xB0, { mode });
    } catch (err) {
      if (err instanceof Error) {
        this.platform.log.error('Failed to set target heater-cooler state:', err.message);
      } else {
        this.platform.log.error('Failed to set target heater-cooler state:', String(err));
      }
    }
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  async handleCurrentTemperatureGet(): Promise<number> {
    this.platform.log.debug('Triggered GET CurrentTemperature');

    let currentValue = -127;

    try {
      const res = await this.getPropertyValueWithCache(this.address, this.eoj, 0xBB, this.cacheTTL.temperature);
      const temperature = res.message.data.temperature;
      currentValue = temperature ?? -127;
    } catch (err) {
      if (err instanceof Error) {
        this.platform.log.error('Failed to get current temperature:', err.message);
      } else {
        this.platform.log.error('Failed to get current temperature:', String(err));
      }
      currentValue = -127;
    }
    return currentValue;
  }

  /**
   * Get threshold temperature (shared by both cooling and heating)
   */
  private async getThresholdTemperature(): Promise<number> {
    try {
      const res = await this.getPropertyValueWithCache(this.address, this.eoj, 0xB3, this.cacheTTL.thresholdTemp);
      const temperature = res.message.data.temperature;
      return temperature ?? 16;
    } catch (err) {
      if (err instanceof Error) {
        this.platform.log.error('Failed to get threshold temperature:', err.message);
      } else {
        this.platform.log.error('Failed to get threshold temperature:', String(err));
      }
      return 16;
    }
  }

  /**
   * Handle requests to get the current value of the "Cooling Threshold Temperature" characteristic
   */
  async handleCoolingThresholdTemperatureGet(): Promise<number> {
    this.platform.log.debug('Triggered GET CoolingThresholdTemperature');
    return await this.getThresholdTemperature();
  }

  /**
   * Handle requests to set the "Cooling Threshold Temperature" characteristic
   */
  async handleCoolingThresholdTemperatureSet(value: CharacteristicValue): Promise<void> {
    this.platform.log.debug('Triggered SET CoolingThresholdTemperature:', value);
    try {
      const temperature = parseInt(String(value));
      await this.setPropertyValue(this.address, this.eoj, 0xB3, { temperature });
    } catch (err) {
      if (err instanceof Error) {
        this.platform.log.error('Failed to set cooling threshold temperature:', err.message);
      } else {
        this.platform.log.error('Failed to set cooling threshold temperature:', String(err));
      }
    }
  }

  /**
   * Handle requests to get the current value of the "Heating Threshold Temperature" characteristic
   */
  async handleHeatingThresholdTemperatureGet(): Promise<number> {
    this.platform.log.debug('Triggered GET HeatingThresholdTemperature');
    return await this.getThresholdTemperature();
  }

  /**
   * Handle requests to set the "Heating Threshold Temperature" characteristic
   */
  async handleHeatingThresholdTemperatureSet(value: CharacteristicValue): Promise<void> {
    this.platform.log.debug('Triggered SET HeatingThresholdTemperature:', value);
    try {
      const temperature = parseInt(String(value));
      await this.setPropertyValue(this.address, this.eoj, 0xB3, { temperature });
    } catch (err) {
      if (err instanceof Error) {
        this.platform.log.error('Failed to set heating threshold temperature:', err.message);
      } else {
        this.platform.log.error('Failed to set heating threshold temperature:', String(err));
      }
    }
  }

  /**
   * Handle status change event
   */
  async updateStates(res: EchonetNotification): Promise<void> {

    const { prop } = res.message;
    if (res.device.address !== this.address) {
      return;
    }

    for (const p of prop) {
      if (!p.edt) {
        continue;
      }

      switch (p.epc) {
        case 0x80: // status
          if (p.edt.status !== undefined) {
            this.platform.log.debug('Received status update - active:', p.edt.status);
            this.isActive = p.edt.status;
            this.service.updateCharacteristic(this.platform.Characteristic.Active, p.edt.status);
          }
          break;
        case 0xB0: //mode
          this.platform.log.debug('Received status update - mode:' + p.edt.mode);
          switch(p.edt.mode){
            case 2: //Cooler
              this.service.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState,
                this.platform.Characteristic.TargetHeaterCoolerState.COOL);
              this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState,
                this.platform.Characteristic.CurrentHeaterCoolerState.COOLING);
              break;
            case 3: //Heater
              this.service.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState,
                this.platform.Characteristic.TargetHeaterCoolerState.HEAT);
              this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState,
                this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
              break;
            default: //Auto
              this.service.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState,
                this.platform.Characteristic.TargetHeaterCoolerState.AUTO);
              this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState,
                this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
              break;
          }
          break;
        case 0xB3: // target temperature
          if (p.edt.temperature !== undefined) {
            this.platform.log.debug('Received status update - target temperature:', p.edt.temperature);
            this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, p.edt.temperature);
            this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, p.edt.temperature);
          }
          break;
        case 0xBB: // current temperature
          if (p.edt.temperature !== undefined) {
            this.platform.log.debug('Received status update - current temperature:', p.edt.temperature);
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, p.edt.temperature);
          }
      }
    }
  }

  /**
   * Check if cache entry is valid
   */
  private isCacheValid(entry: CacheEntry<unknown>): boolean {
    return Date.now() - entry.timestamp < entry.ttl;
  }

  /**
   * Get cached value if valid
   */
  private getCachedValue<T>(epc: number): T | null {
    const entry = this.propertyCache[epc];
    if (entry && this.isCacheValid(entry)) {
      return entry.value as T;
    }
    return null;
  }

  /**
   * Set cache value
   */
  private setCacheValue<T>(epc: number, value: T, ttl: number): void {
    this.propertyCache[epc] = {
      value,
      timestamp: Date.now(),
      ttl,
    };
  }

  /**
   * Get property value with caching
   */
  private async getPropertyValueWithCache(address: string, eoj: number[], edt: number, ttl: number): Promise<EchonetPropertyResponse> {
    // Check cache first
    const cachedValue = this.getCachedValue<EchonetPropertyResponse>(edt);
    if (cachedValue) {
      this.platform.log.debug(`Using cached value for EPC 0x${edt.toString(16)}`);
      return cachedValue;
    }

    // Fetch from device
    try {
      const propertyValue = await this.jobQueue.addJob(async () => {
        return await promisify(this.platform.el.getPropertyValue).bind(this.platform.el)(address, eoj, edt);
      }, 3000); // Shorter timeout for better responsiveness

      const response = propertyValue as EchonetPropertyResponse;

      // Cache the result
      this.setCacheValue(edt, response, ttl);

      return response;
    } catch (err) {
      this.platform.log.warn(`Failed to get property 0x${edt.toString(16)}, using cached or default value`);
      // Return cached value even if expired, or throw if no cache
      const expiredCache = this.propertyCache[edt];
      if (expiredCache) {
        this.platform.log.debug(`Using expired cache for EPC 0x${edt.toString(16)}`);
        return expiredCache.value as EchonetPropertyResponse;
      }
      throw err;
    }
  }

  /**
   * Promisified Echonet.getPropertyValue (legacy method)
   */
  private async getPropertyValue(address: string, eoj: number[], edt: number): Promise<EchonetPropertyResponse> {
    return this.getPropertyValueWithCache(address, eoj, edt, this.cacheTTL.temperature);
  }

  /**
   * Clear cache for specific property
   */
  private clearCache(epc: number): void {
    delete this.propertyCache[epc];
  }

  /**
   * Promisified Echonet.setPropertyValue
   */
  private async setPropertyValue(address: string, eoj: number[], edt: number, value: EchonetSetPropertyValue): Promise<void> {
    try {
      await this.jobQueue.addJob(async () => {
        await promisify(this.platform.el.setPropertyValue).bind(this.platform.el)(address, eoj, edt, value);
      }, 2000); // Shorter timeout for set operations

      // Clear cache after successful set operation
      this.clearCache(edt);

      // Clear related caches
      if (edt === 0x80) {
        // Status change might affect other properties
        this.clearCache(0xB0); // mode
      } else if (edt === 0xB0) {
        // Mode change might affect status display
        this.clearCache(0x80); // status
      }
    } catch (err) {
      // Still clear cache even on error to force fresh read next time
      this.clearCache(edt);
      throw err;
    }
  }

}