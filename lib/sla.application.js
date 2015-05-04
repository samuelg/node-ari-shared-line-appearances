'use strict';

var dal = require('./data/dal.js');
var stateMachine = require('./core/stateMachine.js');

var STATE_MACHINES = {};

function buildApp(client, data, channel) {
	var state;
	var extension = data.extension.name;

	if (STATE_MACHINES[extension]) {
		state = STATE_MACHINES[extension];

		return {
			run: function() {
				state.init(channel);
			}
		};
	}

  state = stateMachine(client, data);
  STATE_MACHINES[extension] = state;

  return {
    run: function() {
      state.init(channel);

			// cleanup on exit
			state.on('exit', function() {
				delete STATE_MACHINES[extension];
			});
    }
  };
}

module.exports = function(client, confFilePath, channel, extension) {
  var data = dal.getData(confFilePath, channel, extension);

  return buildApp(client, data, channel);
};
