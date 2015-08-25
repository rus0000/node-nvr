'use strict';

var Promise = require('bluebird');

module.exports = function (options){
  var that = {},
    methods = ['readFileAsync', 'readdirAsync', 'ensureDirAsync', 'ensureDir', 'moveAsync', 'removeAsync', 'writeFileAsync', 'readJsonAsync', 'outputJsonAsync', 'outputJsonAsync'];
  methods.forEach(function (funcName){
    that[funcName] = function (){
      //console.log(funcName + '(' + Array.prototype.join.call(arguments, ', ') + ')');
      if (arguments.length === 2 && typeof(arguments[1]) === 'function') {
        arguments[1].call(null);
      } else {
        return Promise.resolve();
      }
    };
    options.sinon.spy(that, funcName);
  });
  return that;
};
