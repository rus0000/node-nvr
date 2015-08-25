'use strict';

var EventEmitter = require('events').EventEmitter,
  moment = require('moment');

exports.createFfmpeg = function createFfmpeg(options){
  var that = new EventEmitter();
  that.config = options;
  that.state = 'stopped';
  that.crashCntr = 0;
  that.startedOn = moment();
  that.status = {};

  function log(message){
    that.emit('log', message);
  }

  function changeState(newState){
    that.state = newState;
    log('state: ' + newState);
    that.emit('state', newState);
  }

  that.spawn = function spawn(){
    log('spawn');
    changeState('running');
  };

  that.stop = function stop(){
  };

  exports.spyObj = that;

  return that;
};
