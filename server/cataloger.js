'use strict';
/**
 * Generates catalog.json
 * Inherits EventEmitter
 * Emits: log
 * */
var EventEmitter = require('events').EventEmitter,
  Promise = require('bluebird'),
  _ = require('lodash'),
  path = require('path'),
  moment = require('moment'),
  fse = Promise.promisifyAll(require('fs-extra'));

module.exports = function createCataloger(options){
  var that = new EventEmitter();
  that.config = options;
  that.catalog = {};

  function log(message){
    that.emit('log', message);
  }

  that.read = function read(){
    log('loading');
    return fse.readJsonAsync(path.join(options.catalogDir, options.catalogName))
      .then(function (obj){
        that.catalog = obj;
        return that.catalog;
      })
      .catch(function (err){
        log('cataloger: error reading catalog: ' + path.join(options.catalogDir, options.catalogName) + ', doing rebuildAll');
        log(err);
        return that.rebuildAll()
          .then(that.write);
      });

  };

  that.write = function write(){
    log('writing');
    return fse.outputJsonAsync(path.join(options.catalogDir, options.catalogName), that.catalog)
      .catch(function (err){
        log('error writing catalog: ' + path.join(options.catalogDir, options.catalogName));
        log(err);
      });
  };

  that.rebuildAll = function rebuildAll(){
    log('rebuilding all');
    that.catalog = {
      cameras: []
    };
    options.cameras.forEach(function (camera){
      that.catalog.cameras.push({
        cameraName: camera[0],
        folders: []
      });
    });
    return Promise.map(that.catalog.cameras, function (camera){
      return fse.readdirAsync(path.join(options.catalogDir, camera.cameraName))
        .call('filter', function (dateFolder){
          return dateFolder.length === 8 && moment(dateFolder, 'YYYYMMDD').format('YYYYMMDD') === dateFolder;
        })
        .map(function (dateFolder){
          return that.rebuildDay(camera.cameraName, dateFolder);
        })
        .then(function (){
          return that.catalog;
        })
        .catch(function (err){
          log('rebuildAll error read dir: ' + path.join(options.catalogDir, camera.cameraName));
          log(err);
          return that.catalog;
        });
    });
  };

  that.rebuildDay = function rebuildDay(cameraName, dateFolder){
    log('rebuilding day: ' + cameraName + '/' + dateFolder);
    var camera = _.find(that.catalog.cameras, 'cameraName', cameraName);
    if (!camera) {
      log('Camera: ' + cameraName + ' not found');
      return Promise.resolve();
    }
    return fse.readdirAsync(path.join(options.catalogDir, cameraName, dateFolder))
      .call('filter', function (fileName){
        var p = path.parse(fileName);
        return p.ext === '.mp4' && (p.name.slice(0, 3) === 'out' || p.name.slice(0, 6) === 'motion');
      })
      .then(function (files){
        var folder = {
          folderName: dateFolder,
          out: [],
          motion: []
        };
        files.forEach(function (fileName){
          if (fileName.slice(0, 3) === 'out') {
            folder.out.push(fileName.slice(3, 100).slice(0, -4));
          } else if (fileName.slice(0, 6) === 'motion') {
            folder.motion.push(fileName.slice(6, 100).slice(0, -4));
          }
        });
        var found = _.find(camera.folders, 'folderName', folder.folderName);
        if (found) {
          _.assign(found, folder);
        } else {
          camera.folders.push(folder);
        }
        camera.folders = _.sortBy(camera.folders, 'folderName');
      })
      .catch(function (err){
        log('rebuildDay error read dir: ' + path.join(options.catalogDir, cameraName, dateFolder));
        log(err);
      });
  };

  return that;
};