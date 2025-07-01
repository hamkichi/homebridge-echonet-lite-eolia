# Homebridge Plugin: Echonet Lite for Aircon

English: [README_en.md](https://github.com/hamkichi/homebridge-echonet-lite-aircon/blob/master/README_en.md)

このHomebridgeプラグインは、Echonet Lite対応エアコンを操作するためのプラグインです。

以下の操作をiOSのHomeアプリから実行できるようになります。

- 電源On/Off
- 現在温度の取得
- 設定温度の取得/設定
- 動作モードの取得/設定（自動、暖房、冷房）

## 前提条件

お使いのエアコンがEchonet Liteに対応している必要があります。[こちら](https://panasonic.jp/aircon/hems/list.html)からEchonet Lite対応かどうか確認することができます。

## 設定
プラグインは自動的にネットワーク内のEchonet Lite対応エアコンをスキャンするため、設定項目は特にありません。最低限、以下の設定が必要です。

```
{
    "name": "EoliaPlatform",
    "platform": "EoliaPlatform"
}
```
