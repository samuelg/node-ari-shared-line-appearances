var util = require('util');
var Q = require('q');
var regexp = require('node-regexp');

var customError = require('../util/customError.js');

/**
 * Attempts to access configuration file data for the shared extension
 *   and returns it if it exists.
 * @param {string} config - The SLA configuration
 * @param {string} name - the name of the sharedExtension to access
 * @return {Q} - Q promise object
 */
var getSharedExtension = function(config, name) {
  var sharedExtension = {};

  for (var index = 0; index < config.sharedExtensions.length; index++) {
    var extension = config.sharedExtensions[index];

    if (extension[name]) {
      sharedExtension.name = name;
      sharedExtension.stations = extension[sharedExtension.name].stations;
      sharedExtension.trunks = extension[sharedExtension.name].trunks;

      break;
    }
  }

  if (!sharedExtension.trunks || !sharedExtension.stations) {
    throw new customError.CustomError('InvalidExtension',
        'Invalid specified extension: ' + name);
  }

  return sharedExtension;
};

/**
 * Utility function for checking if a channel is a member of an extension
 * @param {String} extension - the extension in question
 * @param {String} channel - the channel in question
 * @return {Q} - Q promise object
 */
function isStation (extension, channel) {
  var stations = extension.stations;

  for (var index = 0; index < stations.length; index++) {
    var station = stations[index];
    var re = regexp().find(station).toRegExp();

    // First conditional is for regular SIP users like SIP/phone1
    if (re.test(channel.name)) {
    	return true;
    } else {

      // Second conditional is for other SIP users that have a different
      // server like SIP/phone2@1234
      var nameDivided = channel.name.split('/');
      if (re.test(nameDivided[0] + '/' + channel.caller.number + '@' +
          nameDivided[1])) {
            return true;
          }
    }
  }
  return false;
}

module.exports = function() {

  var config;

  /**
 * Returns all relevant data for the extension to be used in module.exports
 * @param {string} confFile - the configuration path and file name
 * @param {Object} channel - the inbound or outbound channel
 * @param {string} extensionName - the name of the extension to access
 */
  getData: function(channel, extensionName) {
    var data = {};
    var self = this;

    var sharedExtension = getSharedExtension(self.config, extensionName);

    data.extension = sharedExtension;
    data.isStation = isStation(data.extension, channel);

    return data;
  },

  init: function(confFilePath) {
    this.config = require(util.format('../../%s', confFilePath));
  }
};
