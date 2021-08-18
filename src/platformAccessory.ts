import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EoliaPlatform } from './platform';
import { promisify } from 'util';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class EoliaPlatformAccessory {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private states = {
    Active: false,
    Mode: 0,
    Temperature: 20,
    TargetTemperature: 20,
    CurrentTemperature: 20,
  };

  private address;
  private eoj;

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

  }

  async handleActiveGet() {
    this.platform.log.info('Triggered GET Active');
    let status = false;
    try {
      const res = await promisify(this.platform.el.getPropertyValue).bind(this.platform.el)(this.address, this.eoj, 0x80);
      status = res.message.data.status;
    } catch (err) {
      status = this.states.Active;
      this.platform.log.info(err);
    }
    // set this to a valid value for Active
    return status;
  }

  /**
   * Handle requests to set the "Active" characteristic
   */
  async handleActiveSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET Active:' + value);
    await promisify(this.platform.el.setPropertyValue).bind(this.platform.el)(this.address, this.eoj, 0x80, {status: value !== 0});
    this.states.Active = (value !== 0);
  }

  /**
   * Handle requests to get the current value of the "Current Heater-Cooler State" characteristic
   */
  async handleCurrentHeaterCoolerStateGet() {
    this.platform.log.debug('Triggered GET CurrentHeaterCoolerState');
    const status = await this.handleActiveGet();
    // set this to a valid value for CurrentHeaterCoolerState
    let currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    if (status) {
      const res = await this.getPropertyValue(this.address, this.eoj, 0xB0);
      const mode = res.message.data.mode;
      currentValue = mode===2 ? this.platform.Characteristic.CurrentHeaterCoolerState.COOLING
        : this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
    }
    return currentValue;
  }


  /**
   * Handle requests to get the current value of the "Target Heater-Cooler State" characteristic
   */
  async handleTargetHeaterCoolerStateGet() {
    this.platform.log.debug('Triggered GET TargetHeaterCoolerState');

    // set this to a valid value for TargetHeaterCoolerState
    let currentValue = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    const status = await this.handleActiveGet();
    if (status) {
      const res = await this.getPropertyValue(this.address, this.eoj, 0xB0);
      const mode = res.message.data.mode;
      if (mode === 2) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
      } else if (mode === 3) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
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
    await this.setPropertyValue(this.address, this.eoj, 0xB0, {mode});
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  async handleCurrentTemperatureGet() {
    this.platform.log.debug('Triggered GET CurrentTemperature');

    const res = await this.getPropertyValue(this.address, this.eoj, 0xBB);
    const currentValue = res.message.data.temperature;
    return currentValue;
  }

  async handleCoolingThresholdTemperatureGet() {
    this.platform.log.debug('Triggered GET CoolingThresholdTemperature');

    const res = await this.getPropertyValue(this.address, this.eoj, 0xB3);
    const currentValue = res.message.data.temperature;
    return currentValue;

  }

  async handleCoolingThresholdTemperatureSet(value) {
    this.platform.log.debug('Triggered SET CoolingThresholdTemperature:' + value);
    await this.setPropertyValue(this.address, this.eoj, 0xB3, {temperature: parseInt(value)});
  }

  async handleHeatingThresholdTemperatureGet() {
    this.platform.log.debug('Triggered GET HeatingThresholdTemperature');

    const res = await this.getPropertyValue(this.address, this.eoj, 0xB3);
    const currentValue = res.message.data.temperature;
    return currentValue;
  }

  async handleHeatingThresholdTemperatureSet(value) {
    this.platform.log.debug('Triggered SET HeatingThresholdTemperature:' + value);
    await this.setPropertyValue(this.address, this.eoj, 0xB3, {temperature: parseInt(value)});
  }

  async getPropertyValue(address, eoj, edt) {
    return await promisify(this.platform.el.getPropertyValue).bind(this.platform.el)(address, eoj, edt);
  }

  async setPropertyValue(address, eoj, edt, value){
    await promisify(this.platform.el.setPropertyValue).bind(this.platform.el)(address, eoj, edt, value);
  }

}