import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME, VERSION } from './settings';
import { EoliaPlatformAccessory } from './platformAccessory';

import EchonetLite from 'node-echonet-lite';
import { promisify } from 'util';


/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class EoliaPlatform implements DynamicPlatformPlugin {
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
      this.el.init((err: string)=>{
        if (err) {
          log.error(err);
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
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    // Start to discover Echonet Lite devices
    this.el.startDiscovery(async (err, res) => {
      if(err) {
        this.log.error(err);
      } else {
        const device = res['device'];
        const address = device['address'];

        for (const eoj of device['eoj']) {
          try {
            // Add to homebridge only if discovered device is AC
            const group_code = eoj[0];
            const class_code = eoj[1];
            if (group_code === 0x01 && class_code === 0x30) {
              res = await promisify(this.el.getPropertyValue).bind(this.el)(address, eoj, 0x83);
              let uuid;
              if (res['message']['data']) {
                uuid = this.api.hap.uuid.generate(res['message']['data']['uid']);
              } else {
                uuid = this.api.hap.uuid.generate(address);
              }
              this.addAccessory(device, address, eoj, uuid);
            }
          } catch (err) {
            if (err instanceof Error) {
              this.log.error(err.message);
            } else {
              this.log.error(String(err));
            }
          }
        }
      }
    });

    setTimeout(()=>{
      this.el.stopDiscovery();
    }, 60 * 1000);
  }

  addAccessory(device, address, eoj, uuid){
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      // create the accessory handler for the restored accessory
      // this is imported from `platformAccessory.ts`
      new EoliaPlatformAccessory(this, existingAccessory);
    } else {
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', address);

      // create a new accessory
      const accessory = new this.api.platformAccessory(address, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.context.address = address;
      accessory.context.eoj = eoj;
      accessory.context.uuid = uuid;

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new EoliaPlatformAccessory(this, accessory);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }
}
