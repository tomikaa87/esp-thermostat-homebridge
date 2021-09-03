import { Service, PlatformAccessory, CharacteristicValue, Logger, PlatformConfig } from 'homebridge';

import { EspThermostatHomebridgePlatform } from './platform';

import * as mqtt from 'mqtt';

export class ThermostatAccessory {
    private readonly service: Service;
    private readonly boostSwitchService: Service;
    private readonly mqttClient: mqtt.Client;
    private readonly log: Logger;

    private states = {
      currentTemperature: 0,
      targetTemperature: 0,
      heatingActive: false,
      boostActive: false,
    };

    constructor(
        private readonly platform: EspThermostatHomebridgePlatform,
        private readonly accessory: PlatformAccessory,
        private readonly config: PlatformConfig,
    ) {
      this.log = platform.log;

      this.log.info(`connecting to MQTT broker: url=${this.config.mqttBrokerUrl}`);
      this.mqttClient = mqtt.connect(this.config.mqttBrokerUrl);

      this.mqttClient.on('connect', this.subscribeToMqttTopics.bind(this));
      this.mqttClient.on('message', this.handleIncomingMqttMessage.bind(this));

      this.service = this.accessory.getService(this.platform.Service.Thermostat)
        || this.accessory.addService(this.platform.Service.Thermostat);

      this.setupThermostatService();

      this.boostSwitchService = this.accessory.getService('Boost')
        || this.accessory.addService(this.platform.Service.Switch, 'Boost');

      this.setupBoostSwitchService();
    }

    setupThermostatService(): void {
      this.service.setCharacteristic(this.platform.Characteristic.Name, 'Thermostat');

      this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(this.getCurrentTemperature.bind(this));

      this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
        .onGet(this.getTargetTemperature.bind(this))
        .onSet(this.setTargetTemperature.bind(this));

      this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
        .onGet(this.getCurrentHeatingState.bind(this));
    }

    setupBoostSwitchService(): void {
      this.boostSwitchService.getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.getBoostSwitchOn.bind(this))
        .onSet(this.setBoostSwitchOn.bind(this));
    }

    subscribeToMqttTopics(): void {
      this.log.info('subscribeToMqttTopics');
      this.mqttClient.subscribe('thermostat/temp/current', undefined);
      this.mqttClient.subscribe('thermostat/temp/active', undefined);
      this.mqttClient.subscribe('thermostat/heating/active', undefined);
    }

    handleIncomingMqttMessage(topic: string, payload: Buffer): void {
      this.log.debug(`handleIncomingMqttMessage: topic=${topic}, packet=${payload.toString()}`);

      if (topic.toLowerCase() === 'thermostat/temp/current') {
        this.states.currentTemperature = Number.parseFloat(payload.toString());
        this.log.info(`handleIncomingMqttMessage: currentTemperature=${this.states.currentTemperature}`);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.states.currentTemperature);
      }

      if (topic.toLowerCase() === 'thermostat/temp/active') {
        this.states.targetTemperature = Number.parseFloat(payload.toString());
        this.log.info(`handleIncomingMqttMessage: targetTemperature=${this.states.targetTemperature}`);
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.states.targetTemperature);
      }

      if (topic.toLowerCase() === 'thermostat/heating/active') {
        this.states.heatingActive = Number.parseInt(payload.toString()) === 1;
        this.log.info(`handleIncomingMqttMessage: heatingActive=${this.states.heatingActive}`);
        this.service.updateCharacteristic(
          this.platform.Characteristic.CurrentHeatingCoolingState,
          this.getHeatingState(this.states.heatingActive),
        );
      }

      if (topic.toLowerCase() === 'thermostat/boost/active') {
        this.states.boostActive = Number.parseInt(payload.toString()) === 1;
        this.log.info(`handleIncomingMqttMessage: boostActive=${this.states.boostActive}`);
        this.boostSwitchService.updateCharacteristic(this.platform.Characteristic.On, this.states.boostActive);
      }
    }

    async getCurrentTemperature(): Promise<CharacteristicValue> {
      this.log.info(`getCurrentTemperature: ${this.states.currentTemperature} C`);
      return this.states.currentTemperature;
    }

    async getTargetTemperature(): Promise<CharacteristicValue> {
      this.log.info(`getTargetTemperature: ${this.states.targetTemperature}`);
      return this.states.targetTemperature;
    }

    async setTargetTemperature(value: CharacteristicValue) {
      this.states.targetTemperature = value as number;
      this.log.info(`setTargetTemperature: ${this.states.targetTemperature}`);

      this.mqttClient.publish('thermostat/temp/active/set', this.states.targetTemperature.toString());
    }

    async getCurrentHeatingState(): Promise<CharacteristicValue> {
      this.log.info(`getCurrentHeatingState: ${this.states.heatingActive}`);
      return this.getHeatingState(this.states.heatingActive);
    }

    getHeatingState(heatingActive: boolean): CharacteristicValue {
      return heatingActive
        ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
        : this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }

    async getBoostSwitchOn(): Promise<CharacteristicValue> {
      this.log.info(`getBoostSwitchOn: ${this.states.boostActive}`);
      return this.states.boostActive;
    }

    async setBoostSwitchOn(value: CharacteristicValue) {
      this.states.boostActive = value as boolean;
      this.log.info(`setBoostSwitchOn: ${this.states.boostActive}`);

      this.mqttClient.publish('thermostat/boost/active/set', this.states.boostActive ? '1' : '0');
    }
}