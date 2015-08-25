'use strict';
/**
 * App entrance point
 * */
if (global.App === undefined) {
  global.App = {};
}

var path = require('path'),
  Promise = require('bluebird'),
  fse = Promise.promisifyAll(require('fs-extra')),
  YAML = require('js-yaml'),
  config = global.App.config = YAML.load(fse.readFileSync(path.join(__dirname, 'config.yaml'))).recorder,
  recorder;

// Simple DI
config.createMonitor = require('./monitor');
config.createConverter = require('./converter');
config.createCleaner = require('./cleaner');
config.createCataloger = require('./cataloger');
config.createFfmpeg = require('./ffmpeg');
config.createFfprobe = require('./ffprobe');
config.fse = fse;

recorder = require('./recorder')(config);

recorder.start();