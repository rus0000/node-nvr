var Mocha = require('mocha'),
  path = require('path');

var mocha = new Mocha();

['monitor.test.js'].forEach(function (file){
  mocha.addFile(path.join(__dirname, file));
});

mocha.run(function (failures){
  process.on('exit', function (){
    process.exit(failures);
  });
});