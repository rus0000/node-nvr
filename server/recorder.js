'use strict';
/**
 * Recorder module
 * Spin-up monitors, schedule video recompression, cataloging and cleanup
 * */

var Promise = require('bluebird'),
  path = require('path'),
  moment = require('moment'),
  winston = require('winston'),
  YAML = require('js-yaml');

/**
 * Crockford's Functional Inheritance OOP model or "decorator pattern"
 * In fact, inheritance itself is not used in this project
 * */
module.exports = function createRecorder(options){
  var conv = options.createConverter({
      createFfmpeg: options.createFfmpeg,
      createFfprobe: options.createFfprobe
    }),
    tasks = [],
    monitorInterval,
    checkRecordingInterval,
    runningTask,
    taskStatus,
    fse = options.fse,
    cleanRecordingCheck = Promise.resolve(),
    recordingDir = path.join(options.workDir, 'recording'),
    catalogDir = path.join(options.workDir, 'catalog'),
    cleaner = options.createCleaner({
      regression: options.cleaner,
      catalogDir: catalogDir,
      cameras: []
    });

  // Recorder object
  var that = {
    config: options,
    monitors: [],
    cataloger: options.createCataloger({
      catalogDir: catalogDir,
      catalogName: options.catalogName,
      cameras: options.cameras
    })
  };

  // creating monitors
  options.cameras.forEach(function (camera){
    var monitor = options.createMonitor({
      cameraName: camera[0],
      cameraAddr: camera[1],
      feedName: camera[2],
      outSpeeds: camera[3],
      motionSpeeds: camera[4],
      recordingDir: recordingDir,
      catalogDir: catalogDir,
      startTime: options.startTime,
      stopTime: options.stopTime,
      consoleLog: options.monitorConsoleLog,
      fileLog: true,
      createFfmpeg: options.createFfmpeg,
      fse: fse
    });

    cleaner.config.cameras.push(camera[0]);
    if (options.monitorLog) {
      monitor.on('log', function (message){
        logger.info('monitor ' + camera[0] + ': ' + message);
      });
    }
    that.monitors.push(monitor);
  });

  function timestamp(){
    return moment().format('YYYY-MM-DD HH:mm:ss.SSS');
  }

  var loggerConf = {
    transports: [
      new (winston.transports.File)({
        filename: path.join(options.workDir, 'recorder_log.txt'),
        showLevel: false,
        json: false,
        timestamp: timestamp
      })
    ]
  };

  if (options.recorderConsoleLog) {
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
    logger.info('recorder: ' + message);
  }

  function taskLog(message){
    logger.info('task: ' + message);
  }

  conv.on('ffmpeg_message', function (message){
    if (options.ffmpegMessageLog) {
      taskLog('ffmpeg message: ' + message);
    }
  });

  conv.on('ffmpeg_log', function (message){
    if (options.ffmpegLog) {
      taskLog('ffmpeg log: ' + message);
    }
  });

  conv.on('ffprobe_log', function (message){
    if (options.ffprobeLog) {
      taskLog('ffprobe log: ' + message);
    }
  });

  conv.on('log', function (message){
    taskLog(message);
  });

  that.cataloger.on('log', function (message){
    logger.info('cataloger: ' + message);
  });

  cleaner.on('log', function (message){
    logger.info('cleaner: ' + message);
  });

  conv.on('status', function (inStatus){
    taskStatus = inStatus;
  });

  conv.on('crash', function (crashData){
    taskLog('ffmpeg crashed with code: ' + crashData.code);
    if (!options.ffmpegLog && !options.ffmpegMessageLog) {
      taskLog('ffmpeg last status: ' + crashData.status.text);
      taskLog('ffmpeg last messages:');
      crashData.messageBuffer.forEach(function (message){
        taskLog('\t' + message);
      });
    }
    taskOnFinish();
  });

  conv.on('error', function (err){
    taskLog('error');
    taskLog(JSON.stringify(err));
    taskOnFinish();
  });

  conv.on('start', function (status){
    taskLog('ffmpeg processing started ...');
  });

  conv.on('finish', function (){
    taskLog('finished');
    taskOnFinish();
  });

  function taskOnFinish(){
    cleaner.clean()
      .then(function (){
        return that.cataloger.rebuildDay(runningTask.cameraName, runningTask.workDay)
          .then(that.cataloger.write)
          .then(function (){
            runningTask = undefined;
            if (tasks.length > 0) {
              tasks[0].taskDelay = moment().add(5, 's');
              log('delaying next task')
            } else {
              log('no more tasks')
            }
          });
      });
  }

  function checkMonitors(){
    if (!runningTask && tasks.length > 0) {
      if (moment().diff(tasks[0].taskDelay) > 0) {
        runningTask = tasks.shift();
        taskStatus = undefined;
        conv.doTask(runningTask);
      }
    }
  }

  function checkRecordingDir(){
    if (!runningTask && tasks.length === 0) {
      if (!cleanRecordingCheck.isPending()) {
        return fse.readFileAsync(path.join(__dirname, 'convert_day.yaml'))
          .then(function (file){
            var convertDay = YAML.load(file) || [];
            if (!convertDay || !convertDay.length) {
              convertDay = [];
            }
            var finishedDate = moment();
            if (moment().hours() < moment(options.startTime, 'HH:mm:ss').hours()) {
              finishedDate.add(-1, 'd');
            }
            convertDay.push(finishedDate.format('YYYYMMDD'));
            return Promise.map(convertDay, checkDay);
          });
      }
    }
  }

  function checkDay(finishedDay){
    cleanRecordingCheck = Promise.map(that.monitors, function (monitor){
      if (monitor.state === 'sleeping') {
        return fse.readdirAsync(path.join(recordingDir, monitor.config.cameraName, finishedDay))
          .call('filter', function (fileName){
            return path.parse(fileName).ext === '.mp4' && fileName.length === 23;
          })
          .then(function (files){
            if (files && files.length > 0) {
              log('found not converted recording');
              that.scheduleTask(monitor, finishedDay);
            }
          })
          .catch(function (err){
            if (err.code !== 'ENOENT') {
              log(err);
            }
          });
      }
    });
  }

  that.scheduleTask = function scheduleTask(monitor, finishedDay){
    log('scheduling tasks with delay');
    tasks.push({
      type: 'segment',
      cameraName: monitor.config.cameraName,
      workDay: finishedDay,
      recordingDir: path.join(recordingDir, monitor.config.cameraName, finishedDay),
      catalogDir: path.join(catalogDir, monitor.config.cameraName, finishedDay),
      outSpeeds: monitor.config.outSpeeds,
      autoClean: true,
      hardClean: false,
      taskDelay: moment().add(5, 's')
    });
    tasks.push({
      type: 'motion',
      cameraName: monitor.config.cameraName,
      workDay: finishedDay,
      motionDir: path.join(recordingDir, monitor.config.cameraName, 'motion'),
      motionMove: true,
      recordingDir: path.join(recordingDir, monitor.config.cameraName, finishedDay),
      catalogDir: path.join(catalogDir, monitor.config.cameraName, finishedDay),
      outSpeeds: monitor.config.motionSpeeds,
      autoClean: true,
      hardClean: true,
      taskDelay: moment().add(5, 's')
    });
  };

  that.start = function start(){
    return cleaner.clean()
      .then(that.cataloger.rebuildAll)
      .then(that.cataloger.write)
      .then(function (){
        if (!options.noRecording) {
          that.monitors.forEach(function (monitor){
            monitor.start();
            monitor.on('sleep', function (finishedDay){
              if (finishedDay && finishedDay.length === 8) {
                that.scheduleTask(monitor, finishedDay);
              }
            });
          });
          if (monitorInterval) {
            clearInterval(monitorInterval);
          }
          monitorInterval = setInterval(checkMonitors, 1000);
          if (checkRecordingInterval) {
            clearInterval(checkRecordingInterval);
          }
          checkRecordingInterval = setInterval(checkRecordingDir, 60000);
        } else {
          log('noRecording is set');
        }
      });
  };

  that.stop = function stop(){
    if (!options.noRecording) {
      that.monitors.map(function (monitor){
        monitor.stop();
      });
      if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = undefined;
      }
      if (checkRecordingInterval) {
        clearInterval(checkRecordingInterval);
        checkRecordingInterval = undefined;
      }
    }
  };

  return that;
};