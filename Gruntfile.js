'use strict';
var path = require('path'),
  open = require('opener');

module.exports = function (grunt){
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    dateString: new Date().toISOString().replace(/\..*Z/, ''),
    concurrent: {
      dev: {
        tasks: ['nodemon', 'node-inspector', 'watch'],
        options: {
          logConcurrentOutput: true
        }
      }
    },
    nodemon: {
      dev: {
        script: 'bin/www',
        options: {
          nodeArgs: ['--debug'],
          ignore: ['node_modules/**', 'public/**'],
          env: {
            PORT: '3000'
          },
          // omit this property if you aren't serving HTML files and
          // don't want to open a browser tab on start
          callback: function (nodemon){
            nodemon.on('log', function (event){
              console.log(event.colour);
            });

            // opens browser on initial server start
            nodemon.on('config:update', function (){
              // Delay before server listens on port
              //setTimeout(function () {
              //  open('http://127.0.0.1:3000');
              //}, 1000);
            });

            // refreshes browser when server reboots
            nodemon.on('restart', function (){
              // Delay before server listens on port
              setTimeout(function (){
                require('fs').writeFileSync('.rebooted', 'rebooted');
              }, 1000);
            });
          }
        }
      }
    },
    'node-inspector': {
      custom: {
        options: {
          'web-port': 8080,
          'web-host': '127.0.0.1',
          'debug-port': 5858,
          'save-live-edit': true,
          'no-preload': false,
          'stack-trace-limit': 50,
          'hidden': ['node_modules']
        }
      }
    },
    watch: {
      js_html: {
        files: ['public/**'],
        options: {
          livereload: true
        }
      }
    }
  });
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-concurrent');
  grunt.loadNpmTasks('grunt-nodemon');
  grunt.loadNpmTasks('grunt-node-inspector');

  grunt.registerTask('default', ['concurrent']);
};