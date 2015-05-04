'use strict';

var util = require('util');

var Q = require('q');

var getOrCreateBridge = require('./helpers/getOrCreateBridge.js');
var originator = require('./helpers/originator.js');
var isStation = require('./helpers/isStation.js');

function create(client, data) {
  var bridge;

  // incoming channels
  var incoming = {};
  // channels originated by sla application
  var participants = {};

  var stateMachine = {
    states: {
      BUSY: 'BUSY',
      INUSE: 'INUSE',
      IDLE: 'NOT_INUSE',
      RINGING: 'RINGING',
      UNKNOWN: 'UNKNOWN'
    },

    handlers: {},

    dialString: '',

    allowDtmf: true,

    trunkEnteredStasis: false,

    addIncoming: function(channel) {
      incoming[channel.id] = channel;

      channel.once('ChannelHangupRequest', this.onChannelHangup);
    },

    cleanupIncomingEvents: function(id) {
      var channel = incoming[id];

      channel.removeListener('ChannelHangupRequest',
                             this.onChannelHangup);
      channel.removeListener('ChannelDtmfReceived',
                             this.onChannelDtmfReceived);
    },

    // helpers
    addParticipant: function(participant) {
      participants[participant.id] = participant;

      participant.once('StasisStart', this.onParticipantStasisStart);
      participant.once('ChannelDestroyed', this.onParticipantHangup);
    },

    participantsIsEmpty: function() {
      return !Object.keys(participants).length;
    },

    isStation: function(candidateId) {
      return (incoming[candidateId]) ? incoming[candidateId].isStation
                                     : participants[candidateId].isStation;
    },

    cleanupParticipantEvents: function(id) {
      var participant = participants[id];
      participant.removeListener('StasisStart',
                                   this.onParticipantStasisStart);
      participant.removeListener('ChannelDestroyed',
                                 this.onParticipantHangup);
    },

    updateState: function(state) {
      var deviceState = Q.denodeify(
        client.deviceStates.update.bind(client)
      );

      this.currentState = state;

      return deviceState({
        deviceName: util.format('Stasis:%s', data.extension.name),
        deviceState: state
      });
    },

    // event helpers
    on: function(eventType, handler) {
      this.handlers[eventType] = handler;
    },

    // state transitions
    init: function(channel) {
      var self = this;

      var extensionName = data.extension.name;

      channel.isStation = isStation(data.extension, channel);

      this.addIncoming(channel);

      // Answer the channel
      var answered = Q.denodeify(channel.answer.bind(channel))();

      // Get the current device state
      var getDeviceState = Q.denodeify(
        client.deviceStates.get.bind(client.deviceStates)
      );

      answered.then(function() {
        return getDeviceState({
          deviceName: util.format('Stasis:%s', extensionName)
        });
      }).then(function (deviceState) {
        self.currentState = deviceState.state;

        self.getBridge(channel);
      })
      .done();
    },

    busy: function (channel) {
      channel.continueInDialplan();
      this.exit();
    },

    getBridge: function(channel) {
      // Get the bridge if it exists, else create a new one
      getOrCreateBridge.call(this, {
        client: client,
        data: data,
        channel: channel
      });
    },

    bridgeLoaded: function(instance, channel) {
      bridge = instance;

      bridge.on('ChannelLeftBridge', this.onChannelLeftBridge);

      this.originator = originator.call(this, {
        client: client,
        channel: channel,
        bridge: bridge,
        data: data
      });

      this.originator.init();
    },

    joinBridge: function(channel, participant) {
      var addChannel = Q.denodeify(bridge.addChannel.bind(bridge));

      addChannel({channel: channel.id})
        .done();

      console.log('Incoming added');

      if (participant) {
        addChannel({channel: participant.id})
          .done();

        console.log('Participant added');
      }
    },

    getDtmf: function(channel) {
      this.dialString = '';
      channel.on('ChannelDtmfReceived', this.onChannelDtmfReceived);
    },

    stationsReady: function() {
      var self = this;

      data.extension.stations.forEach(function(station) {
        self.originator.originate(
          station,
          {isStation: true}
        );
      });
    },

    exit: function(err) {

      var self = this;

      stateMachine.updateState(stateMachine.states.IDLE);

      if (err) {
        var hangup = Q.denodeify(client.channels.hangup.bind(client));

        this.incoming.forEach(function(channel) {
          hangup({channelId: channel.id});
        });
      }

      bridge.removeListener('ChannelLeftBridge',
                            this.onChannelLeftBridge);

      if (incoming.length) {
        incoming.forEach(function(channel) {
          self.cleanupIncomingEvents(channel.id);
        });
      }

      if (participants.length) {
        participants.forEach(function(participant) {
          self.cleanupParticipantEvents(participant.id);
        });
      }

      // call exit event handler
      if (this.handlers['exit']) {
        this.handlers['exit']();
      }
      this.handlers = {};
    },

    // event handlers
    onChannelHangup: function(event, channel) {

      delete incoming[channel.id];

      if (stateMachine.participantsIsEmpty()) {
        stateMachine.exit();
      }

      // TODO: what about other incoming channels?
      if (participants.length) {
        participants.forEach(function(participant) {
          var hangup = Q.denodeify(participant.hangup.bind(participant));

          hangup();
        });
      }
    },

    // requirement: if all stations hangup, caller is hungup
    // currently: if caller hangs up, all stations are hungup
    onChannelLeftBridge: function(event, object) {

      console.log(util.format('Channel %s left the bridge'), object.channel.id);

      var isStation = stateMachine.isStation(object.channel.id);

      if (isStation) {

        // filter for non stations, if it matches length, hang them all up
        var nonStations = object.bridge.channels.filter(function(candidateId) {

          return !stateMachine.isStation(candidateId);
        });

        if (nonStations.length === bridge.channels.length) {
          var hangup = Q.denodeify(client.channels.hangup.bind(client));

          bridge.channels.forEach(function(id) {
            hangup({channelId: id});
          });
        }
      }

      if (bridge.channels.length === 0) {
        stateMachine.exit();
      }
    },

    onChannelDtmfReceived: function(event) {
      if (!stateMachine.allowDtmf) {
        return;
      }

      var digit = event.digit;

      switch (digit) {
        case '#':
          stateMachine.updateState(stateMachine.states.RINGING);

          stateMachine.allowDtmf = false;

          stateMachine.originator.originate(
            util.format(
              'SIP/%s@%s',
              stateMachine.dialString,
              data.extension.trunks[0]
            ),
            {isStation: false}
          );

          break;

        default:
          stateMachine.dialString += digit;

          break;
      }
    },

    onParticipantStasisStart: function(event, participant) {

      stateMachine.trunkEnteredStasis = true;

      var answer = Q.denodeify(participant.answer.bind(participant));
      answer();

      var channels = Object.keys(participants).filter(function(candidateId) {
        return candidateId !== participant.id;
      });

      channels.forEach(function(id) {
        console.log('Hanging up the rest');

        var hangup = Q.denodeify(client.channels.hangup.bind(client));

        hangup({channelId: id});

        stateMachine.cleanupParticipantEvents(id);
      });

      stateMachine.updateState(stateMachine.states.INUSE);

      console.log('Joining the bridge');

      stateMachine.joinBridge(participant);
    },

    onParticipantHangup: function(event, participant) {
      delete participants[participant.id];

      if (stateMachine.participantsIsEmpty() &&
          !stateMachine.trunkEnteredStasis) {

        console.log('All participants hungup');

        stateMachine.exit();
      }
    }
  };

  return stateMachine;
}

module.exports = function(client) {
  return create(client);
};
