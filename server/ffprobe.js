'use strict';
/**
 * Manages of one ffprobe process
 * Inherits EventEmitter
 * Emits: log, exit, error
 * */
var EventEmitter = require('events').EventEmitter,
  child_process = require('child_process'),
  Promise = require('bluebird'),
  streamSplit = require('split');

module.exports = function makeFfprobe(options){
  var that = new EventEmitter();
  that.config = options;

  function log(message){
    that.emit('log', message);
  }

  that.test = function spawn(fileName, cwd){
    return new Promise(function (resolve, reject){
      var ffprobe,
        status = {
          fileName: fileName,
          stream: [],
          duration: undefined,
          error: undefined,
          exitCode: 0
        };

      ffprobe = child_process.spawn('ffprobe', [fileName], {
        cwd: cwd
      });
      log(cwd + '/ffprobe ' + fileName);

      ffprobe.on('exit', function (code){
        log(ffprobe.pid + ' exited with code ' + code);
        status.exitCode = code;
        that.emit('exit', status);
        resolve(status);
      });

      ffprobe.on('error', function (err){
        logger.err('error: ');
        log(JSON.stringify(err));
        that.emit('error', err);
        status.error = err;
        resolve(status);
      });

      ffprobe.stderr.pipe(streamSplit(/[\r\n]+/)).on('data', function (data){
        var line = data.trim();
        if (line.indexOf('Stream #') === 0) {
          status.stream.push(line);
        } else if (line.indexOf('Duration') === 0) {
          status.duration = line.slice(10, 21);
        }
      });
    });
  };

  return that;
};

