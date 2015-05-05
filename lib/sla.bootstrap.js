'use strict';

module.exports = function(confFilePath) {
  var sla = require('./sla.application.js')(confFilePath);
  sla.run();
};
