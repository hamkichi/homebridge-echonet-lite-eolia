import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EoliaPlatform } from './platform';
import { promisify } from 'util';
import { JobQueue } from './jobQueue';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class EoliaPlatformAccessory {
  private service: Service;

  private address;
  private eoj;
  private isActive = false; //power on: true, off: false
  private jobQueue: JobQueue = new JobQueue();

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
  async handleActiveGet() {
    this.platform.log.debug('Triggered GET Active');

    let currentValue = false;

    try {
      const res = await this.getPropertyValue(this.address, this.eoj, 0x80);
      currentValue = res.message.data.status;
      this.isActive = currentValue;
    } catch (err) {
      currentValue = this.isActive;
      this.platform.log.error(err);
    }

    return currentValue;
  }

  /**
   * Handle requests to set the "Active" characteristic
   */
  handleActiveSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET Active:' + value);

    try {
      this.setPropertyValue(this.address, this.eoj, 0x80, {status: value !== 0});
      this.isActive = (value !== 0);
    } catch (err) {
      this.platform.log.error(err);
    }
  }

  /**
   * Handle requests to get the current value of the "Current Heater-Cooler State" characteristic
   */
  async handleCurrentHeaterCoolerStateGet() {
    this.platform.log.debug('Triggered GET CurrentHeaterCoolerState');

    const active = await this.handleActiveGet();
    let currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;

    if (active) {
      const res = await this.getPropertyValue(this.address, this.eoj, 0xB0);
      try {
        const mode = res.message.data.mode;
        currentValue = mode===2 ? this.platform.Characteristic.CurrentHeaterCoolerState.COOLING
          : this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
      } catch (err) {
        this.platform.log.error(err);
      }
    }
    return currentValue;
  }

  /**
   * Handle requests to get the current value of the "Target Heater-Cooler State" characteristic
   */
  async handleTargetHeaterCoolerStateGet() {
    this.platform.log.debug('Triggered GET TargetHeaterCoolerState');

    let currentValue = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;

    if (this.isActive) {
      const res = await this.getPropertyValue(this.address, this.eoj, 0xB0);
      try {
        const mode = res.message.data.mode;
        if (mode === 2) {
          currentValue = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
        } else if (mode === 3) {
          currentValue = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
        }
      } catch (err) {
        this.platform.log.error(err);
      }
    }

    return currentValue;
  }

  /**
   * Handle requests to set the "Target Heater-Cooler State" characteristic
   */
  async handleTargetHeaterCoolerStateSet(value) {
    this.platform.log.debug('Triggered SET TargetHeaterCoolerState:' + value);

    let mode = 1; // AUTO
    if (value === this.platform.Characteristic.TargetHeaterCoolerState.COOL) {
      mode = 2; //COOLER
    } else if (value === this.platform.Characteristic.TargetHeaterCoolerState.HEAT) {
      mode = 3; //HEATER
    }

    this.setPropertyValue(this.address, this.eoj, 0xB0, {mode});
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  async handleCurrentTemperatureGet() {
    this.platform.log.debug('Triggered GET CurrentTemperature');

    let currentValue = -127;

    try {
      const res = await this.getPropertyValue(this.address, this.eoj, 0xBB);
      currentValue = res.message.data.temperature;
    } catch (err) {
      this.platform.log.error(err);
    }
    return currentValue;
  }

  /**
   * Handle requests to get the current value of the "Cooling Threshold Temperature" characteristic
   */
  async handleCoolingThresholdTemperatureGet() {
    this.platform.log.debug('Triggered GET CoolingThresholdTemperature');

    let currentValue = 16;
    try {
      const res = await this.getPropertyValue(this.address, this.eoj, 0xB3);
      currentValue = res.message.data.temperature;
    } catch (err) {
      this.platform.log.error(err);
    }

    return currentValue;
  }

  /**
   * Handle requests to set the "Cooling Threshold Temperature" characteristic
   */
  handleCoolingThresholdTemperatureSet(value) {
    this.platform.log.debug('Triggered SET CoolingThresholdTemperature:' + value);
    this.setPropertyValue(this.address, this.eoj, 0xB3, {temperature: parseInt(value)});
  }

  /**
   * Handle requests to get the current value of the "Heating Threshold Temperature" characteristic
   */
  async handleHeatingThresholdTemperatureGet() {
    this.platform.log.debug('Triggered GET HeatingThresholdTemperature');

    let currentValue = 16;

    try {
      const res = await this.getPropertyValue(this.address, this.eoj, 0xB3);
      currentValue = res.message.data.temperature;
    } catch (err) {
      this.platform.log.error(err);
    }

    return currentValue;
  }

  /**
   * Handle requests to set the "Heating Threshold Temperature" characteristic
   */
  async handleHeatingThresholdTemperatureSet(value) {
    this.platform.log.debug('Triggered SET HeatingThresholdTemperature:' + value);
    this.setPropertyValue(this.address, this.eoj, 0xB3, {temperature: parseInt(value)});
  }

  /**
   * Handle status change event
   */
  async updateStates(res) {

    const { prop } = res.message;
    if (res.device.address !== this.address) {
      return;
    }

    for (const p of prop) {
      if (!p.edt) {
        continue;
      }

      switch (p.epc) {
        case 0x80: //status
          this.platform.log.debug('Received status update - active:' + p.edt.status);
          this.service.updateCharacteristic(this.platform.Characteristic.Active, p.edt.status);
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
              break;
          }
          break;
        case 0xB3: //target temperature
          this.platform.log.debug('Received status update - target temperature:' + p.edt.temperature);
          this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, p.edt.temperature);
          this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, p.edt.temperature);
          break;
        case 0xBB: //current temperature
          this.platform.log.debug('Received status update - current temperature:' + p.edt.temperature);
          this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, p.edt.temperature);
      }
    }
  }

  /**
   * Promisified Echonet.getPropertyValue
   */
  async getPropertyValue(address, eoj, edt) {
    const propertyValue = await this.jobQueue.addJob(() => {
      return new Promise(resolve => {
        const result = promisify(this.platform.el.getPropertyValue).bind(this.platform.el)(address, eoj, edt);
        resolve(result);
      });
    });
    return propertyValue;
  }

  /**
   * Promisified Echonet.setPropertyValue
   */
  async setPropertyValue(address, eoj, edt, value){
    await this.jobQueue.addJob(() => {
      return new Promise<void>(resolve => {
        promisify(this.platform.el.setPropertyValue).bind(this.platform.el)(address, eoj, edt, value);
        resolve();
      });
    });
  }

}