
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>


# Homebridge Plugin: Echonet Lite for Eolia

This plugin controls Panasonic's air conditioners(Eolia) via Echonet Lite protocol.  You can do following operations via iOS Home app:

- Power on/off
- Get current temperature
- Get/Set target temperature
- Get/Set target mode(Auto, Heating, Cooling)

I have tested only with my own ACs sold in Japan.

## Requirement
Your AC must be compatible with Echonet Lite. You can check if your device is conpatible or not [here](https://panasonic.jp/aircon/hems/list.html)

## Configuration
Currently there are no configurations to change as the plugin can discover your AC automatically. Just add following configuration and the plugin will work.

```
{
    "name": "EoliaPlatform",
    "platform": "EoliaPlatform"
}
```