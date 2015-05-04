var util = require('util');
var Q = require('q');

var customError = require('../util/customError.js');

/**
 * Attempts to access configuration file data for the shared extension
 *   and returns it if it exists.
 * @param {string} confFilePath - tpath and filename to the configuration file
 * @param {string} name - the name of the sharedExtension to access
 * @return {Q} - Q promise object
 */
var getSharedExtension = function(confFilePath, name) {
  var sharedExtension = {};
  var data = require(util.format('../../%s', confFilePath));

  for (var index = 0; index < data.sharedExtensions.length; index++) {
    var extension = data.sharedExtensions[index];

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
 * Returns all relevant data for the extension to be used in module.exports
 * @param {string} confFile - the configuration path and file name
 * @param {Object} channel - the inbound or outbound channel
 * @param {string} extensionName - the name of the extension to access
 */
function getData(confFile, channel, extensionName) {
  var data = {};

  var sharedExtension = getSharedExtension(confFile, extensionName);

  data.extension = sharedExtension;

  return data;
}

module.exports = {
  getData: getData
};
