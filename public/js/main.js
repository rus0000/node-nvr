jQuery(function ($){
  'use strict';
  function server(query, fn){
    $.ajax({
      url: query,
      success: fn
    });
  }

  var catalog;
  server('/video/catalog.json', function (resp, status){
    catalog = resp;
    catalog.cameras.forEach(function (camera){
      if (camera.folders && camera.folders.length > 0) {
        var enabledDates = [];
        camera.folders.forEach(function (folder){
          if (folder.out.length > 0 || folder.motion.length > 0) {
            enabledDates.push(moment(folder.folderName, 'YYYYMMDD'));
          }
        });
        //console.log(enabledDates);
        $('#datetimepicker-' + camera.cameraName).data("DateTimePicker").enabledDates(enabledDates);
        if (camera.folders.length > 0) {
          $('#datetimepicker-' + camera.cameraName).data("DateTimePicker").date(enabledDates[enabledDates.length - 1]);
          loadDate(camera.cameraName, enabledDates[enabledDates.length - 1]);
        }
      }
    });
  });

  $('#datetimepicker-cam1').datetimepicker({
    locale: 'ru',
    inline: true,
    format: 'YYYYMMDD',
    minDate: moment("20150301", 'YYYYMMDD'),
    sideBySide: false
  });

  $("#datetimepicker-cam1").on("dp.change", function (e){
    loadDate('cam1', e.date.format('YYYYMMDD'));
  });

  $('#datetimepicker-cam2').datetimepicker({
    locale: 'ru',
    inline: true,
    format: 'YYYYMMDD',
    minDate: moment("20150228", 'YYYYMMDD'),
    sideBySide: false
  });

  $("#datetimepicker-cam2").on("dp.change", function (e){
    loadDate('cam2', e.date.format('YYYYMMDD'));
  });

  function loadDate(cameraName, date){
    var camera = _.find(catalog.cameras, 'cameraName', cameraName),
      folder,
      activeSpeed,
      allSpeeds = [],
      selectSpeeds = ['m50x', 'm20x', 'm10x', 'm5x', 'm1x', '50x', '20x', '10x', '5x', '1x'];
    if (!camera) {
      return;
    }
    folder = _.find(camera.folders, 'folderName', date);
    if (!folder) {
      return;
    }
    $('#' + cameraName + ' button').addClass('disabled');
    folder.out.forEach(function (item){
      $('#' + cameraName + ' button[data-speed="' + item + '"]').removeClass('disabled');
      allSpeeds.push(item);
    });
    folder.motion.forEach(function (item){
      $('#' + cameraName + ' button[data-speed="m' + item + '"]').removeClass('disabled');
      allSpeeds.push('m' + item);
    });
    $('#' + cameraName + ' .speed-buttons button').each(function (){
      var $this = $(this);
      $this.click(function (){
        this.blur();
        var $this = $(this);
        $('#' + cameraName + ' button').removeClass('active');
        $this.addClass('active');
        loadVideo(cameraName, date, $this.data('speed'));
      });
    });
    //default speed last active or 20x
    activeSpeed = $('#' + cameraName + ' button.active').data('speed');
    if (!activeSpeed) {
      activeSpeed = 'm20x';
    }
    //finding good speed
    if (!_.includes(allSpeeds, activeSpeed)) {
      activeSpeed = _.find(selectSpeeds, function (speed){
        return _.includes(allSpeeds, speed);
      });
    }
    $('#' + cameraName + ' button').removeClass('active');
    $('#' + cameraName + ' button[data-speed="' + activeSpeed + '"]').addClass('active');
    loadVideo(cameraName, date, activeSpeed);
  }

  function loadVideo(cameraName, date, speed){
    var s;
    if (speed.slice(0, 1) === 'm') {
      s = 'motion' + speed.slice(1) + '.mp4';
    } else {
      s = 'out' + speed + '.mp4';
    }
    $('#' + cameraName + ' video source').attr('src', '/video/' + cameraName + '/' + date + '/' + s);
    $('#' + cameraName + ' video').load();
  }
});