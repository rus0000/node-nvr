'use strict';
/**
 * Manages compression of video using finite state machine model
 * States: running_segment, running_motion1, running_motion2, error, finished, cleaning, cataloging
 * Inherits EventEmitter
 * Emits: log, state, ffmpeg_log, ffprobe_log, ffmpeg_message, error, finish, status
 * */
var EventEmitter = require('events').EventEmitter,
  path = require('path'),
  Promise = require('bluebird'),
  lodash = require('lodash'),
  fse = Promise.promisifyAll(require('fs-extra'));

module.exports = function createConverter(options){
  var that = new EventEmitter();
  that.state = 'stopped';
  var ffmpeg = options.createFfmpeg({
      messageBuffer: 30,
      streaming: false,
      stopTimeout: 5000
    }),
    ffprobe = options.createFfprobe(),
    status,
    task = {},
    list = [],
    args,
    videoList = [],
    cleanList = [],
    noHardClean = false;

  function changeState(newState){
    that.state = newState;
    log('state: ' + newState);
    that.emit('state', newState);
  }

  function log(message){
    that.emit('log', message);
  }

  ffprobe.on('log', function (message){
    that.emit('ffprobe_log', message);
  });

  ffmpeg.on('log', function (message){
    that.emit('ffmpeg_log', message);
  });

  ffmpeg.on('error', function (err){
    log('ffmpeg error');
    log(JSON.stringify(err));
    changeState('error');
    that.emit('error', err);
  });

  ffmpeg.on('exit', function (code){
    if (code !== 0) {
      log('ffmpeg crash');
      changeState('error');
      that.emit('crash', {
        code: code,
        messageBuffer: ffmpeg.messageBuffer,
        status: ffmpeg.status
      });
      if (task.autoClean) {
        log('no cleaning performed');
      }
      return;
    }
    log('ffmpeg exit');
    if (that.state == 'running_motion1') {
      motion2();
    } else {
      that.catalog()
        .then(function (){
          if (task.autoClean) {
            return that.clean();
          }
        })
        .then(function (){
          changeState('finished');
          that.emit('finish');
        });
    }
  });

  ffmpeg.on('status', function (inStatus){
    status = inStatus;
    that.emit('status', status);
  });

  ffmpeg.on('message', function (message){
    that.emit('ffmpeg_message', message);
  });

  ffmpeg.on('start', function (inStatus){
    that.emit('start', inStatus);
  });

  function spawn(){
    //log('spawn');
    ffmpeg.spawn(args, task.recordingDir);
  }

  that.doTask = function doTask(inTask){
    status = undefined;
    list = [];
    args = undefined;
    cleanList = [];
    videoList = [];
    noHardClean = false;
    task = inTask;
    log(JSON.stringify(task));
    if (task.type === 'segment') {
      segment();
    } else if (task.type === 'motion') {
      motion1();
    }
  };

  that.catalog = function catalog(){
    changeState('cataloging');
    return fse.ensureDirAsync(task.catalogDir)
      .then(function (){
        return Promise.map(videoList, function (fileName){
          return fse.moveAsync(path.join(task.recordingDir, fileName), path.join(task.catalogDir, fileName), {clobber: true})
            .catch(function (err){
              log('error moving file: ' + path.join(task.recordingDir, fileName) + ' to ' + path.join(task.catalogDir, fileName));
              log(err);
              noHardClean = true;
            });
        }, {concurency: 1});
      })
      .catch(function (err){
        log('error ensure dir: ' + task.catalogDir);
        log(err);
      });
  };

  that.clean = function clean(){
    changeState('cleaning');
    if (task.hardClean) {
      if (!noHardClean) {
        return fse.removeAsync(task.recordingDir)//rm -rf
          .then(function (){
            log('removed ' + task.recordingDir);
          })
          .catch(function (err){
            log('error remove dir: ' + task.recordingDir);
            log(err);
          });
      } else {
        return Promise.resolve();
      }
    } else {
      return fse.ensureDirAsync(path.join(task.recordingDir, 'del'))
        .then(function (){
          return Promise.map(cleanList, function (fileName){
            return fse.moveAsync(path.join(task.recordingDir, fileName), path.join(task.recordingDir, 'del', fileName), {clobber: true})
              .catch(function (err){
                log('error moving file: ' + path.join(task.recordingDir, fileName) + ' to ' + path.join(task.recordingDir, 'del', fileName));
                log(err);
              });
          }, {concurency: 1});
        })
        .catch(function (err){
          log('error ensure dir: ' + path.join(task.recordingDir, 'del'));
          log(err);
        });
    }
  };

  function segment(){
    fse.readdirAsync(task.recordingDir)
      .call('filter', function (fileName){
        return path.parse(fileName).ext === '.mp4' && fileName.length === 23;
      })
      .map(function (fileName){
        return ffprobe.test(fileName, task.recordingDir);
      }, {concurrency: 5})
      .then(function (tests){
        tests.forEach(function (test){
          if (!test.err && test.exitCode === 0 && test.duration) {
            list.push(test.fileName);
          } else {
            log('bad file: ' + test.fileName);
          }
          cleanList.push(test.fileName);
        });
        if (list.length === 0) {
          log('list empty');
          that.emit('finish');
          changeState('finished');
          return;
        }
        list = list.sort();
        var ffconcat = 'ffconcat version 1.0\n';
        list.forEach(function (item){
          ffconcat += 'file ' + item + '\n';
        });
        fse.writeFileAsync(path.join(task.recordingDir, 'segments.ffconcat'), ffconcat)
          .then(function (){
            cleanList.push('segments.ffconcat');
            args = '-y -f concat -i segments.ffconcat';
            var outSpeeds = lodash.uniq(task.outSpeeds);
            outSpeeds.forEach(function (outSpeed){
              switch (outSpeed) {
                case '1x':
                  args += ' -c:v libx264 -r 10 -b:v 100k out1x.mp4';
                  videoList.push('out1x.mp4');
                  break;
                case '2x':
                  args += ' -c:v libx264 -filter:v setpts=0.5*PTS -r 25 -b:v 300k out2x.mp4';
                  videoList.push('out2x.mp4');
                  break;
                case '5x':
                  args += ' -c:v libx264 -filter:v setpts=0.2*PTS -r 25 -b:v 300k out5x.mp4';
                  videoList.push('out5x.mp4');
                  break;
                case '10x':
                  args += ' -c:v libx264 -filter:v setpts=0.1*PTS -r 25 -b:v 300k out10x.mp4';
                  videoList.push('out10x.mp4');
                  break;
                case '20x':
                  args += ' -c:v libx264 -filter:v setpts=0.05*PTS -r 25 -b:v 300k out20x.mp4';
                  videoList.push('out20x.mp4');
                  break;
                case '50x':
                  args += ' -c:v libx264 -filter:v setpts=0.02*PTS -r 25 -b:v 300k out50x.mp4';
                  videoList.push('out50x.mp4');
                  break;
              }
            });
            args = args.replace('  ', ' ');
            spawn();
            changeState('running_segment');

          })
          .catch(function (err){
            log('error write file: ' + path.join(task.recordingDir, 'segments.ffconcat'));
            log(err);
          });
      })
      .catch(function (err){
        log('error read dir: ' + task.recordingDir);
        log(err);
      });
  }

  function motion1(){
    fse.readdirAsync(task.motionDir)
      .call('filter', function (fileName){
        var p = path.parse(fileName);
        return p.name.slice(0, 8) === task.workDay && p.ext === '.avi' && fileName.length === 19;
      })
      .then(function (files){
        if (task.motionMove) {
          return Promise.map(files, function (fileName){
            return fse.moveAsync(path.join(task.motionDir, fileName), path.join(task.recordingDir, fileName))
              .catch(function (err){
                log('error moving file: ' + path.join(task.motionDir, fileName) + ' to ' + path.join(task.recordingDir, fileName));
                log(err);
              });
          }, {concurrency: 1})
            .then(function (){
              return files;
            });
        } else {
          return files;
        }
      })
      .map(function (fileName){
        return ffprobe.test(fileName, task.recordingDir);
      }, {concurrency: 5})
      .then(function (tests){
        tests.forEach(function (test){
          if (!test.err && test.exitCode === 0 && test.duration) {
            list.push(test.fileName);
          } else {
            log('bad file: ' + test.fileName);
          }
          cleanList.push(test.fileName);
        });
        if (list.length === 0) {
          log('list empty');
          that.emit('finish');
          changeState('finished');
          return;
        }
        list = list.sort();
        args = [];
        args.push('-y');
        var s1 = '';
        list.forEach(function (fileName, index){
          args.push('-i');
          args.push(fileName);
          s1 += '[' + index + ':0]';
        });
        args.push('-filter_complex');
        args.push(s1 + ' concat=n=' + list.length + ':v=1:a=0 [v]');//аs cmd line one argument
        args = args.concat('-map [v] -c:v libx264 -r 10 -b:v 300k motion1x.mp4'.split(' '));

        spawn();
        changeState('running_motion1');

      })
      .catch(function (err){
        log('error read dir: ' + task.motionDir);
        log(err);
      });
  }

  function motion2(){
    args = '-y -i motion1x.mp4';
    var outSpeeds = lodash.uniq(task.outSpeeds);
    if (outSpeeds.indexOf('1x') === -1) {
      cleanList.push('motion1x.mp4');
    } else {
      videoList.push('motion1x.mp4');
    }
    outSpeeds.forEach(function (outSpeed){
      switch (outSpeed) {
        case '2x':
          args += ' -c:v libx264 -filter:v setpts=0.5*PTS -r 20 -b:v 300k motion2x.mp4';
          videoList.push('motion2x.mp4');
          break;
        case '5x':
          args += ' -c:v libx264 -filter:v setpts=0.2*PTS -r 25 -b:v 300k motion5x.mp4';
          videoList.push('motion5x.mp4');
          break;
        case '10x':
          args += ' -c:v libx264 -filter:v setpts=0.1*PTS -r 25 -b:v 300k motion10x.mp4';
          videoList.push('motion10x.mp4');
          break;
        case '20x':
          args += ' -c:v libx264 -filter:v setpts=0.05*PTS -r 25 -b:v 300k motion20x.mp4';
          videoList.push('motion20x.mp4');
          break;
        case '50x':
          args += ' -c:v libx264 -filter:v setpts=0.02*PTS -r 25 -b:v 300k motion50x.mp4';
          videoList.push('motion50x.mp4');
          break;
      }
    });
    args = args.replace('  ', ' ');

    spawn();
    changeState('running_motion2');
  }

  return that;
};

