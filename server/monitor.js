'use strict';
/**
 * Manages recording video from one camera using finite state machine model
 * States: running, to_sleeping, sleeping, stopping, stopped, error, restarting
 * Inherits EventEmitter
 * Emits: log, state, ffmpeg_log, error, stop, sleep
 * */
var EventEmitter = require('events').EventEmitter,
  moment = require('moment'),
  path = require('path'),
  winston = require('winston');

module.exports = function createMonitor(options){
  var that = new EventEmitter();
  that.state = 'stopped';
  that.config = options;

  var cameraName = options.cameraName,
    cameraAddr = options.cameraAddr,
    feedName = options.feedName,
    startTime = moment(options.startTime, 'HH:mm:ss'),
    stopTime = moment(options.stopTime, 'HH:mm:ss'),
    recordingDir = options.recordingDir,
    todayDir = '',
    thisDay = '',
    finishedDay,
    ffmpeg = options.createFfmpeg({
      messageBuffer: 30,
      streaming: true,
      stopTimeout: 5000
    }),
    fse = options.fse,
    monitorInterval;

  function timestamp(){
    return moment().format('YYYY-MM-DD HH:mm:ss.SSS');
  }

  var loggerConf = {transports: []};

  if (options.fileLog) {
    loggerConf.transports.push(
      new (winston.transports.File)({
        filename: path.join(recordingDir, cameraName, 'log.txt'),
        showLevel: false,
        json: false,
        timestamp: timestamp
      })
    )
  }
  if (options.consoleLog) {
    loggerConf.transports.push(
      new (winston.transports.Console)({
        showLevel: false,
        timestamp: timestamp
      }));
  }
  var logger = new winston.Logger(loggerConf);

  logger.on('error', function (err){
    console.log('logger error');
    console.log(err);
  });

  function log(message){
    logger.info(message);
    that.emit('log', message);
  }

  function changeState(newState){
    that.state = newState;
    log('state: ' + newState);
    that.emit('state', newState);
  }

  ffmpeg.on('log', function (message){
    logger.info('ffmpeg ' + message);
    that.emit('ffmpeg_log', message);
  });

  ffmpeg.on('error', function (err){
    log('ffmpeg error');
    log(JSON.stringify(err));
    changeState('error');
    that.emit('error', err);
  });

  ffmpeg.on('start', function (message){
    log('ffmpeg processing started ...');
  });

  ffmpeg.on('crash', function (message){
    log('ffmpeg crash ' + ffmpeg.crashCntr);
    if (that.state === 'running') {
      setTimeout(reSpawn, 3000);
    }
  });

  ffmpeg.on('exit', function (message){
    if (that.state === 'stopping') {
      changeState('stopped');
      that.emit('stop');
    } else if (that.state === 'restarting') {
      setTimeout(reSpawn, 3000);
      changeState('running');
    } else if (that.state === 'to_sleeping') {
      changeState('sleeping');
      that.emit('sleep', finishedDay);
    }
  });

  function reSpawn(){
    log('reSpawn');
    //read from camera, split by 5min segments, stream to ffserver for live view and motion detection
    var args = '-y -i http://' + cameraAddr + '/h264.mpt -c:v libx264 -f segment -segment_time 300 -r 10 -b:v 128k ' + moment().format('HHmmss_SSS') + '_out2x%03d.mp4 http://127.0.0.1:8090/' + feedName;
    ffmpeg.spawn(args, todayDir);
  }

  that.start = function start(){
    log('Monitor start');
    startTime = moment(options.startTime, 'HH:mm:ss');
    stopTime = moment(options.stopTime, 'HH:mm:ss');
    thisDay = moment().format('YYYYMMDD');
    todayDir = path.join(recordingDir, cameraName, thisDay);
    return fse.ensureDirAsync(todayDir)
      .then(function (){
        if (monitorInterval) {
          clearInterval(monitorInterval);
        }
        monitorInterval = setInterval(monitor, 1000);
        changeState('sleeping');
      });
  };

  that.stop = function stop(){
    if (that.state = 'running') {
      changeState('stopping');
      ffmpeg.stop();
    }
    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = undefined;
    }
  };

  function monitor(){
    if (that.state === 'stopped') {
      return;
    }
    if (that.state === 'running' && ffmpeg.state === 'running') {
      if (ffmpeg.status.frameProcessedOn && moment().diff(ffmpeg.status.frameProcessedOn, 'seconds') > 30) {
        log('ffmpeg hangs');
        changeState('restarting');
        ffmpeg.stop();
      }
    }

    var today = moment().format('YYYYMMDD');
    if (thisDay !== today) {
      thisDay = today;
      todayDir = path.join(recordingDir, cameraName, thisDay);
      fse.ensureDir(todayDir, function (){
        if (that.state === 'running') {
          changeState('restarting');
          ffmpeg.stop();
        }
        startTime = moment(options.startTime, 'HH:mm:ss');
        stopTime = moment(options.stopTime, 'HH:mm:ss');
      });
    } else {
      var isWorkTime = moment().diff(startTime) > 0 && moment().diff(stopTime) < 0;
      if (stopTime.diff(startTime) < 0) {
        isWorkTime = !isWorkTime;
      } else if (stopTime.diff(startTime) === 0) {
        isWorkTime = true;
      }
      if (that.state === 'running' && !isWorkTime) {
        finishedDay = thisDay;
        changeState('to_sleeping');
        ffmpeg.stop();
      } else if (that.state === 'sleeping' && isWorkTime) {
        setTimeout(reSpawn, 3000);
        changeState('running');
      }
    }
  }

  return that;
};

