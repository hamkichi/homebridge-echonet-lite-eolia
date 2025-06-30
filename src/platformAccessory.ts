import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EoliaPlatform } from './platform.js';
import { promisify } from 'util';
import { JobQueue } from './jobQueue.js';
import { EchonetPropertyResponse, EchonetNotification, EchonetSetPropertyValue } from './types.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class EoliaPlatformAccessory {
  private readonly service: Service;

  private readonly address: string;
  private readonly eoj: number[];
  private isActive = false; // power on: true, off: false
  private readonly jobQueue: JobQueue = new JobQueue();

  constructor(
    private readonly platform: EoliaPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.address = accessory.context.address;
    this.eoj = accessory.context.eoj;

    // set accessory information
    // Manufacturer(0x8A): Panasonic's manufacturer code is 11 so set fixed value
    // Model(0x8c): All my ACs return { code: 'CS-000000000' }
    // SerialNumber(0x8D): All my ACs return null so set IP Addr
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Panasonic')
      .setCharacteristic(this.platform.Characteristic.Model, 'CS-000000000')
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
      const res = await this.getPropertyValue(this.address, this.eoj, 0x80);
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
        const res = await this.getPropertyValue(this.address, this.eoj, 0xB0);
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
        const res = await this.getPropertyValue(this.address, this.eoj, 0xB0);
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
      const res = await this.getPropertyValue(this.address, this.eoj, 0xBB);
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
   * Handle requests to get the current value of the "Cooling Threshold Temperature" characteristic
   */
  async handleCoolingThresholdTemperatureGet(): Promise<number> {
    this.platform.log.debug('Triggered GET CoolingThresholdTemperature');

    let currentValue = 16;
    try {
      const res = await this.getPropertyValue(this.address, this.eoj, 0xB3);
      const temperature = res.message.data.temperature;
      currentValue = temperature ?? 16;
    } catch (err) {
      if (err instanceof Error) {
        this.platform.log.error('Failed to get cooling threshold temperature:', err.message);
      } else {
        this.platform.log.error('Failed to get cooling threshold temperature:', String(err));
      }
      currentValue = 16;
    }

    return currentValue;
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

    let currentValue = 16;

    try {
      const res = await this.getPropertyValue(this.address, this.eoj, 0xB3);
      const temperature = res.message.data.temperature;
      currentValue = temperature ?? 16;
    } catch (err) {
      if (err instanceof Error) {
        this.platform.log.error('Failed to get heating threshold temperature:', err.message);
      } else {
        this.platform.log.error('Failed to get heating threshold temperature:', String(err));
      }
      currentValue = 16;
    }

    return currentValue;
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
   * Promisified Echonet.getPropertyValue
   */
  private async getPropertyValue(address: string, eoj: number[], edt: number): Promise<EchonetPropertyResponse> {
    const propertyValue = await this.jobQueue.addJob(async () => {
      return await promisify(this.platform.el.getPropertyValue).bind(this.platform.el)(address, eoj, edt);
    });
    return propertyValue as EchonetPropertyResponse;
  }

  /**
   * Promisified Echonet.setPropertyValue
   */
  private async setPropertyValue(address: string, eoj: number[], edt: number, value: EchonetSetPropertyValue): Promise<void> {
    await this.jobQueue.addJob(async () => {
      await promisify(this.platform.el.setPropertyValue).bind(this.platform.el)(address, eoj, edt, value);
    });
  }

}