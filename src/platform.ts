import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME, VERSION } from './settings.js';
import { EchonetLiteAirconAccessory } from './platformAccessory.js';
import { EchonetDevice, EchonetDiscoveryResult, EchonetPropertyResponse } from './types.js';
import { getManufacturerInfo, getManufacturerName } from './manufacturerCodes.js';

import EchonetLite from 'node-echonet-lite';
import { promisify } from 'util';


/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class EchonetLiteAirconPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly el: typeof EchonetLite = new EchonetLite({ 'type': 'lan' });

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.el.setLang('ja');
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.el.init((err: Error | null) => {
        if (err) {
          log.error('Failed to initialize Echonet Lite:', err.message);
        } else {
          this.discoverDevices();
        }
      });
      log.info('finish launching version:' + VERSION);
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices(): Promise<void> {
    // Start to discover Echonet Lite devices
    this.el.startDiscovery(async (err: Error | null, res: EchonetDiscoveryResult) => {
      if (err) {
        this.log.error('Discovery error:', err.message);
      } else {
        const device = res.device;
        const address = device.address;

        for (const eoj of device.eoj) {
          try {
            // Add to homebridge only if discovered device is AC
            const groupCode = eoj[0];
            const classCode = eoj[1];
            if (groupCode === 0x01 && classCode === 0x30) {
              const propertyRes = await promisify(this.el.getPropertyValue).bind(this.el)(address, eoj, 0x83) as EchonetPropertyResponse;
              let uuid: string;
              if (propertyRes.message.data && propertyRes.message.data.uid) {
                uuid = this.api.hap.uuid.generate(propertyRes.message.data.uid);
              } else {
                uuid = this.api.hap.uuid.generate(address);
              }

              // Get manufacturer information
              let manufacturerCode: string | undefined;
              try {
                const manufacturerRes = await promisify(this.el.getPropertyValue)
                  .bind(this.el)(address, eoj, 0x8A) as EchonetPropertyResponse;
                if (manufacturerRes.message.data && manufacturerRes.message.data.code) {
                  manufacturerCode = manufacturerRes.message.data.code;
                  const manufacturerName = getManufacturerName(manufacturerCode);
                  this.log.info(`Discovered air conditioner: ${manufacturerName} (code: ${manufacturerCode}) at ${address}`);
                }
              } catch (err) {
                this.log.debug('Could not retrieve manufacturer code:',
                  err instanceof Error ? err.message : String(err));
              }

              this.addAccessory(device, address, eoj, uuid, manufacturerCode);
            }
          } catch (err) {
            if (err instanceof Error) {
              this.log.error('Error processing device:', err.message);
            } else {
              this.log.error('Unknown error processing device:', String(err));
            }
          }
        }
      }
    });

    setTimeout(() => {
      this.el.stopDiscovery();
    }, 60 * 1000);
  }

  private addAccessory(device: EchonetDevice, address: string, eoj: number[], uuid: string, manufacturerCode?: string): void {
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

      // Update manufacturer information if available
      if (manufacturerCode) {
        existingAccessory.context.manufacturerCode = manufacturerCode;
        const manufacturerInfo = getManufacturerInfo(manufacturerCode);
        if (manufacturerInfo) {
          existingAccessory.context.manufacturer = manufacturerInfo;
        }
      }

      // create the accessory handler for the restored accessory
      // this is imported from `platformAccessory.ts`
      new EchonetLiteAirconAccessory(this, existingAccessory);
    } else {
      // the accessory does not yet exist, so we need to create it
      const manufacturerName = manufacturerCode ? getManufacturerName(manufacturerCode) : 'Unknown';
      const displayName = `${manufacturerName} Air Conditioner`;

      this.log.info('Adding new accessory:', displayName);

      // create a new accessory
      const accessory = new this.api.platformAccessory(displayName, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.context.address = address;
      accessory.context.eoj = eoj;
      accessory.context.uuid = uuid;

      // Store manufacturer information
      if (manufacturerCode) {
        accessory.context.manufacturerCode = manufacturerCode;
        const manufacturerInfo = getManufacturerInfo(manufacturerCode);
        if (manufacturerInfo) {
          accessory.context.manufacturer = manufacturerInfo;
        }
      }

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new EchonetLiteAirconAccessory(this, accessory);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }
}
