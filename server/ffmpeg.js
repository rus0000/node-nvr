'use strict';
/**
 * Manages of one ffmpeg process using finite state machine model
 * States: running, stopping, killing, stopped, error
 * Inherits EventEmitter
 * Emits: log, start, state, kill, stop, crash, finish, exit, close, error, message
 * */
var EventEmitter = require('events').EventEmitter,
  child_process = require('child_process'),
  moment = require('moment'),
  streamSplit = require('split'),
  CBuffer = require('CBuffer');

module.exports = function createFfmpeg(options) {
  var that = new EventEmitter();
  that.config = options;
  that.state = 'stopped';
  that.crashCntr = 0;
  that.startedOn = moment();
  that.status = {};
  that.messageBuffer = new CBuffer(options.messageBuffer);

  var ffmpeg,
    ffmpegStoppingTimeout,
    ffmpegClosed;

  function log(message) {
    that.emit('log', message);
  }

  function changeState(newState) {
    that.state = newState;
    log('state: ' + newState);
    that.emit('state', newState);
  }

  that.spawn = function spawn(inArgs, cwd) {
    log('spawn');
    var args;
    if (inArgs instanceof Array) {
      args = inArgs;
    } else {
      args = inArgs.split(' ');
    }
    ffmpeg = child_process.spawn('ffmpeg', args, {
      cwd: cwd
    });
    log(cwd + '/ffmpeg ' + args.join(' '));

    that.status = {};
    that.messageBuffer.empty();
    ffmpegClosed = false;
    that.startedOn = moment();
    changeState('running');

    ffmpeg.on('exit', function (code) {
      if (ffmpegStoppingTimeout) {
        clearTimeout(ffmpegStoppingTimeout);
      }
      ffmpegStoppingTimeout = undefined;
      log(ffmpeg.pid + ' exited with code ' + code);
      //log('Last status: ' + JSON.stringify(that.status).replace(/["{}]/g, '').replace(/,/g, ' '));
      log('Last status: ' + that.status.text);
      log('Last messages:');
      that.messageBuffer.forEach(function (message) {
        log('\t' + message);
      });
      if (that.state === 'killing') {
        log('killed, output corrupted');
        that.emit('kill', code);
      } else if (that.state === 'stopping') {
        log('stopped');
        that.emit('stop');
      } else if (that.state === 'running') {
        if (options.streaming) {
          that.crashCntr++;
          log('crashed, crashCntr: ' + that.crashCntr);
          that.emit('crash', code);
        } else {
          if (code !== 0) {
            log('crashed');
            that.emit('crash', code);
          } else {
            log('finished');
            that.emit('finish', code);
          }
        }
      }
      changeState('stopped');
      that.emit('exit', code);
    });

    ffmpeg.on('close', function () {
      log('io streams closed');
      that.emit('close');
      ffmpegClosed = true;
    });

    ffmpeg.on('error', function (err) {
      changeState('error');
      if (ffmpegStoppingTimeout) {
        clearTimeout(ffmpegStoppingTimeout);
      }
      ffmpegStoppingTimeout = undefined;
      logger.err('error: ');
      log(JSON.stringify(err));
      that.emit('error', err);
    });

    //https://github.com/NOVP-Open-Source/plain-ffmpeg/blob/master/plain-ffmpeg.js
    //https://github.com/eugeneware/ffmpeg-progress-stream/blob/master/index.js
    // streamSplit() makes sure the parser will get whole lines
    ffmpeg.stderr.pipe(streamSplit(/[\r\n]+/)).on('data', function (data) {
      var line = data.trim();
      if (line.indexOf('frame=') === 0) {
        var start = !that.status.frame;
        //var info = line.split('\n')[0].trim().split(/[\s=]+/);
        var info = line.split(/[\s=]+/);
        for (var i = 0; i < info.length; i += 2) {
          that.status[info[i]] = info[i + 1];
        }
        that.status.frameProcessedOn = moment();
        that.status.text = '';
        Object.keys(that.status).forEach(function (key) {
          if (key !== 'text') {
            if (key === 'frameProcessedOn') {
              that.status.text += key + ': ' + that.status[key].format('YYYY-MM-DD HH:mm:ss.SSS');
            } else {
              that.status.text += key + ': ' + that.status[key] + ', ';
            }
          }
        });
        that.status.text = that.status.text.trim();
        if (start) {
          log('processing started ...');
          that.emit('start', that.status);
        }
        that.emit('status', that.status);
      } else if (line.length > 0) {
        that.messageBuffer.push(line);
        that.emit('message', line);
      }
    });

    ffmpeg.stdin.on('close', function () {
      //log('ffmpeg.stdin closed');
      ffmpegClosed = true;
    });

    ffmpeg.stdin.on('error', function (err) {
      log('ffmpeg.stdin.on error catched');
    });

    ffmpeg.stdout.on('error', function (err) {
      log('ffmpeg.stdout.on error catched');
    });

    ffmpeg.stderr.on('error', function (err) {
      log('ffmpeg.stderr.on error catched');
    });
  };

  that.stop = function stop() {
    if (that.state === 'running') {
      if (!ffmpegClosed) {
        log('graceful stop requested');
        try {
          ffmpeg.kill('SIGTERM');
        } catch (err) {
          log('send "q" error catched');
        }
        ffmpegStoppingTimeout = setTimeout(function () {
          ffmpegStoppingTimeout = undefined;
          log('graceful stop timed out, killing, ffmpeg.pid: ' + ffmpeg.pid);
          ffmpeg.kill('SIGTERM');
          changeState('killing');
          //Output file will be corrupted
        }, options.stopTimeout);
        changeState('stopping');
      } else {
        log('killing, ffmpeg.pid: ' + ffmpeg.pid);
        ffmpeg.kill('SIGKILL');
        changeState('killing');
      }
    } else if (that.state === 'stopped') {
      that.emit('exit');
    }
  };

  return that;
};

