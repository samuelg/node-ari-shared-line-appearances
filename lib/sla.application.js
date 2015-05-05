'use strict';

var ari = require('ari-client');

var Q = require('q');
var util = require('util');

var config = require('./config/app.config.json');
var stateMachine = require('./core/stateMachine.js');

function connect(config) {
  var connection = Q.denodeify(ari.connect);
  var uri = util.format('%s://%s:%s',
                        config.protocol,
                        config.host,
                        config.port);

  return connection(uri,
                    config.credentials.user,
                    config.credentials.password);
}

function onClientLoaded(client, confFilePath) {
  stateMachine.init(client, confFilePath);

  client.start('sla');
  client.on('StasisStart', onStasisStart);
}

function onStasisStart(event, channel) {
  var extension = event.args[0];

  // Channels that we have dialed from within an SLA instance should not
  // spin up a new instance of the application.
  if (extension !== 'dialed') {
    stateMachine.resolveContext(channel, extension);
  }
}

module.exports = function(confFilePath) {
  return {
    run: function () {
      connect(config.ari.client)
      .then(function (client, confFilePath) {
        onClientLoaded(client);
      })
      .done();
  }
};
