'use strict';

var chai = require('chai'),
  sinonChai = require('sinon-chai'),
  createMonitor = require('../server/monitor'),
  path = require('path'),
  moment = require('moment'),
  Promise = require('bluebird'),
  sinon = require('sinon'),
  fse = Promise.promisifyAll(require('fs-extra')),
  YAML = require('js-yaml'),
  config = YAML.load(fse.readFileSync(path.join(__dirname, '../server/config.yaml'))).recorder,
  mock = require('./mock/mock'),
  ffmpeg = mock.ffmpeg;

chai.should();
chai.use(sinonChai);

config.createFfmpeg = ffmpeg.createFfmpeg;
config.fse = mock.fse({sinon: sinon});

describe('Monitor', function (){
  after(function (){
    monitor.stop();
  });
  var camera = config.cameras[0],
    monitor = createMonitor({
      cameraName: camera[0],
      cameraAddr: camera[1],
      feedName: camera[2],
      outSpeeds: camera[3],
      motionSpeeds: camera[4],
      recordingDir: path.join(__dirname, './testdir'),
      catalogDir: path.join(config.workDir, 'catalog'),
      startTime: moment().add(-1, 'm').format('HH:mm:ss'),
      stopTime: moment().add(10, 's').format('HH:mm:ss'),
      consoleLog: config.monitorConsoleLog,
      fileLog: false,
      createFfmpeg: config.createFfmpeg,
      fse: config.fse
    });

  // Testing state changes

  var stateSpy = sinon.spy();
  monitor.on('state', stateSpy);

  //monitor.on('log', function (msg){
  //  console.log('Monitor: ' + msg)
  //});
  //monitor.on('ffmpeg_log', function (msg){
  //  console.log('ffmpeg_log: ' + msg)
  //});

  it('has initial state "stopped"', function (){
    monitor.should.have.property('state', 'stopped');
  });

  it('after start has state "sleeping"', function (){
    return monitor.start()
      .then(function (){
        monitor.should.have.property('state', 'sleeping');
        stateSpy.should.have.been.calledOnce;
        stateSpy.should.have.been.calledWith('sleeping');
      });
  });

  it('after 1000 delay has state "running"', function (){
    return Promise.delay(1100)
      .then(function (){
        monitor.should.have.property('state', 'running');
        stateSpy.should.have.callCount(2);
        stateSpy.should.have.been.calledWith('running');
      });
  });

  var ffmpegSpawnSpy = sinon.spy(ffmpeg.spyObj, 'spawn');
  it('after 3000 delay has called ffmpeg.spawn', function (){
    this.timeout(3500);

    return Promise.delay(3100)
      .then(function (){
        ffmpegSpawnSpy.should.have.been.calledOnce;
      });
  });

  it('after 3000 delay after ffmpeg crash has called ffmpeg.spawn', function (){
    this.timeout(3500);

    ffmpeg.spyObj.emit('crash');

    return Promise.delay(3100)
      .then(function (){
        ffmpegSpawnSpy.should.have.been.calledTwice;
        sinon.restore(ffmpeg.spyObj, 'spawn');
      });
  });

  it('after 10s of work has called ffmpeg.stop and has state "to_sleep"', function (){
    this.timeout(5000);

    var ffmpegStopSpy = sinon.spy(ffmpeg.spyObj, 'stop');

    return Promise.delay(4000)
      .then(function (){
        ffmpegStopSpy.should.have.been.calledOnce;
        monitor.should.have.property('state', 'to_sleeping');
      });
  });

  it('after ffmpeg emit "exit" has state "sleeping', function (){
    ffmpeg.spyObj.emit('exit');

    monitor.should.have.property('state', 'sleeping');
  });

});