# Homebridge Plugin: Echonet Lite for Air Conditioners

This plugin controls air conditioners via Echonet Lite protocol.  You can do following operations via iOS Home app:

- Power on/off
- Get current temperature
- Get/Set target temperature
- Get/Set target mode(Auto, Heating, Cooling)

Compatible with various air conditioner manufacturers including Panasonic, Mitsubishi, Daikin, Sharp, and others.

## Requirement
Your air conditioner must be compatible with Echonet Lite protocol.

## Configuration
Currently there are no configurations to change as the plugin can discover your AC automatically. Just add following configuration and the plugin will work.

```
{
    "name": "EchonetLiteAircon",
    "platform": "EchonetLiteAircon"
}
```