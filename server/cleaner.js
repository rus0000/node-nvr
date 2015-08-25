'use strict';
/**
 * Removes outdated video files as stated in config
 * Inherits EventEmitter
 * Emits: log
 * */
var EventEmitter = require('events').EventEmitter,
  Promise = require('bluebird'),
  _ = require('lodash'),
  path = require('path'),
  moment = require('moment'),
  fse = Promise.promisifyAll(require('fs-extra'));

module.exports = function createCleaner(options){
  var that = new EventEmitter();
  that.config = options;

  function log(message){
    that.emit('log', message);
  }

  that.clean = function clean(){
    log('cleaning old files');
    var cleanList = []; //full path
    return Promise.map(that.config.cameras, function (cameraName){
      return fse.readdirAsync(path.join(that.config.catalogDir, cameraName))
        .call('filter', function (dateFolder){
          return dateFolder.length === 8 && moment(dateFolder, 'YYYYMMDD').format('YYYYMMDD') === dateFolder;
        })
        .map(function (dateFolder){
          var folderAge = parseInt(moment().diff(moment(dateFolder, 'YYYYMMDD'), 'days'), 10),
            keepFiles = [],
            activeAge = _.findLast(Object.keys(that.config.regression), function (ageKey){
              return folderAge > parseInt(ageKey);
            });
          if (!activeAge) {
            return Promise.resolve();
          }
          that.config.regression[activeAge][0].forEach(function (file){
            keepFiles.push('out' + file + '.mp4');
          });
          that.config.regression[activeAge][1].forEach(function (file){
            keepFiles.push('motion' + file + '.mp4');
          });
          return fse.readdirAsync(path.join(options.catalogDir, cameraName, dateFolder))
            .call('filter', function (fileName){
              var p = path.parse(fileName);
              return p.ext === '.mp4' && (p.name.slice(0, 3) === 'out' || p.name.slice(0, 6) === 'motion');
            })
            .then(function (files){
              files.forEach(function (fileName){
                if (!_.includes(keepFiles, fileName)) {
                  cleanList.push(path.join(options.catalogDir, cameraName, dateFolder, fileName));
                }
              });
            })
            .catch(function (err){
              log('error read dir: ' + path.join(that.config.catalogDir, cameraName, dateFolder));
              log(err);
            });
        }, {concurrency: 5})
        .catch(function (err){
          log('error read dir: ' + path.join(that.config.catalogDir, cameraName));
          log(err);
        });
    }, {concurrency: 5})
      .then(function (){
        cleanList = _.uniq(cleanList);
        return Promise.map(cleanList, function (fileName){
          //log('removed ' + fileName);
          return fse.removeAsync(fileName)
            .then(function (){
              log('removed ' + fileName);
            })
            .catch(function (err){
              log('error removing file: ' + fileName);
              log(err);
            });
        }, {concurrency: 5});
      })
      .then(function (){ //clean empty dirs
        return Promise.map(that.config.cameras, function (cameraName){
          return fse.readdirAsync(path.join(that.config.catalogDir, cameraName))
            .call('filter', function (dateFolder){
              return dateFolder.length === 8 && moment(dateFolder, 'YYYYMMDD').format('YYYYMMDD') === dateFolder;
            })
            .map(function (dateFolder){
              return fse.readdirAsync(path.join(options.catalogDir, cameraName, dateFolder))
                .then(function (files){
                  if (!files || files.length === 0) {
                    //log('removed ' + path.join(options.catalogDir, cameraName, dateFolder));
                    return fse.removeAsync(path.join(options.catalogDir, cameraName, dateFolder))//rm -rf
                      .then(function (){
                        log('removed ' + path.join(options.catalogDir, cameraName, dateFolder));
                      })
                      .catch(function (err){
                        log('error removing dir: ' + path.join(options.catalogDir, cameraName, dateFolder));
                        log(err);
                      });
                  }
                  return Promise.resolve();
                })
                .catch(function (err){
                  log('error read dir: ' + path.join(that.config.catalogDir, cameraName, dateFolder));
                  log(err);
                });
            }, {concurrency: 5})
            .catch(function (err){
              log('error read dir: ' + path.join(that.config.catalogDir, cameraName));
              log(err);
            });
        }, {concurrency: 5});
      });
  };
  return that;
};