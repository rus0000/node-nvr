# Node Network Video Recorder (node-nvr)
Node.js app for continuous video recording from remote IP web cams over Internet to the local hard drive.

App intended for 24/7 video surveillance with modest hardware resources and handy video review on daily basis.

Uses `ffmpeg`, `ffserver`, `motion` for video capture. Tested on Ubuntu Server 14.04 LTS.

![alt example](/public/images/example.jpg "Example UI")

# Features
- H264, MJPEG or RTSP streaming mode
- Simultaneous recording from several web cams over Internet
- Live view
- Solve problem of fast video playback to view whole day at a glance
- Recompression of video files
- Motion detection 
- Handles all network, web cam or ffmpeg failures during video stream recording without losing recorded data
- It is working cloud video recording solution but for free, well almost
- Allows to utilize cheap IP web cams like D-Link DCS-931L
- Video catalog management to not exhaust hard drive space

Sound recording not yet supported.

# Audience
This repo intended to be used as a boilerplate for creating your own recording solution. This is not a production ready app for end user. There are many features not taken in account.

If you are just looking for free, all-in-one solution, consider using [ZoneMinder](https://github.com/ZoneMinder/ZoneMinder). Besides, there are a lot of [cloud subscription-based services](https://www.google.com/search?q=cloud+video+surveillance)

# Motivation
Goals
- To take video recording under control
- To be able view recorded video on iPad/Android tablets/smartphones
- Quickly review a whole day at a glance, not spending several hours. To achieve this we need to be able playback video at different speeds, up to 50x, and cut-off the still picture (silence).

Why not ZoneMinder?
[ZoneMinder](https://github.com/ZoneMinder/ZoneMinder) is free open source (GNU GPL) video recording solution. ZoneMinder is great, but.
- Most important thing, which I do not like in ZoneMinder, is a video review process. I required [much clearer UI](https://github.com/rus0000/node-nvr/blob/master/public/images/example.jpg) with iOS-like simplicity for viewing video
- ZoneMinder requires MySQL database
- ZoneMinder doesn't solve problem of fast video playback and quick day review
- ZoneMinder cannot handle h264 on my cam, but ffmpeg can

It has many great, but not useful for me, features. This app features are not coming even close to those of ZoneMinder, and I have no plans to make comparable by functionality application.

# Recording
## H.264 format
h264 is a must use format. It is much better than MJPEG. With the same frame rate, h264 will require five times smaller network bandwidth than MJPEG. That mean that at the same bit rate you will get much better image quality.

Most of now available video recording solutions does not support h264 at all. At the same time, most of even cheapest web cams support it. You can find secret url for h264 live streaming of your web cam [here](http://www.ispyconnect.com/man.aspx) or [here](http://www.zoneminder.com/wiki/index.php/D-Link).

## Node.js app
This Node.js app used only to control video recording process, recording itself is performed by ffmpeg instances. App performs recording monitoring, recording scheduling, recompression, cataloging and cleaning.

## ffmpeg
Based on configuration and schedule, node.js app creates instances of ffmpeg and constantly monitors them. Streaming video over Internet is quite unstable process. ffmpeg regularly hangs or crashes and monitor detects it, kills and respawns process. To preserve recorded video during crash, ffmpeg instructed with `segment` command, which produces bunch of 5min length files. All these files are assembled and recompressed at the end of the day and then deleted.

## ffserver
ffserver is a permanently running process in Linux managed by Upstart. It is configured to receive streams from all ffmpeg processes, buffers them and serve them to motion server. It is also serves live streams to client browsers.

ffmpeg cannot serve video to motion server directly because both of them act as clients to video streams. ffmpeg posts video to ffserver and motion gets it from server. So motion needs a video server where to take video from.

## Motion
Motion server is a permanently running process in Linux managed by Upstart. It is configured to receive all streams from ffserver. It processes streams on the fly and generates files where only motion is recorded. These files are also assembled and recompressed at the end of the day and then deleted.

ffserver and motion server both support only MJPEG format, but because they are installed on a same machine it is not affects quality as we easily can set up 3Mbps bit rate between them. It is important to use h264 only over Internet, between web cams and our server.

## ffprobe
App uses ffprobe during recompression phase at the end of day to detect broken video files. They are logged and just deleted.

## Nginx
Nginx serve all static content to client browsers including .mp4 video files. It is also proxies ffserver live streams. And will proxy node.js REST API calls for Admin UI in future.

Simplest security setup here is a self-signed SSL certificate and exclusive https access to static content with basic password authentication. For proxied https requests, Nginx acts as an SSL termination proxy.

# Output
Every camera recordings stored in a separate folders by camera names. For every recording day app creates a separate folder with mask YYYMMDD. At the end of every day for each camera, we get many .mp4 files from ffmpeg and many .avi files from motion. They are named "out" and "motion" respectively. App prepares a queue of recompressing tasks for each camera and each type of video streams. These tasks are spawn one by one. For assembly and recompression, ffmpeg started with a command, which produces several output files for handy reviewing them in a browser. Recompressing tasks are really processor intensive and take around 1 hour for each task.

At the end of recompression, we get following files:
- motion1x.mp4
- motion5x.mp4
- motion10x.mp4
- motion20x.mp4
- motion50x.mp4
- out1x.mp4
- out5x.mp4
- out10x.mp4
- out20x.mp4
- out50x.mp4

Files are marked with a playback speed, which is a hard-coded into video. And this is a goal of all this recording application. You can easily choose required speed just in a browser and quickly watch through the whole day. You can set up which play back speeds you need. Of course, faster speed files are way smaller.

# Cataloging and cleaning
For each camera and every day, app stores a bunch of out and motion video files. Faster speeds allow you to quickly review the whole day, slower speeds allow come close to details. After some time you may already do not need to store some fat out1X  files. App takes this under control. You can setup amount of days after which app will delete mentioned files. See config.yaml. For example, delete out1x files after a week, out5x files after a two weeks and so on, leaving to history only motion50x, which takes no more than 4Mb.

After cleaning at the end of every day, app rebuilds catalog.json file, which is served to the client app to disable speed selection buttons.

# Logging
System generates recording logs for each camera and one common log. All stored just to local files. They are interesting mostly for debugging purposes and can be disabled or customized. Logs are not managed for truncation.

# Watching video
## UI
You can easily create your own. This app is mainly about recording and video files management. There is an example UI that I use for my tasks in /public folder of this repo. It is hard coded with two cameras and written with JQuery. 

White speed buttons under video player are for full-length videos at different playback speeds and green for motion only. Calendar at right shows dates for which recorded files are found. You can choose date, choose camera, choose playback speed and watch recorded video on any tablet or smartphone. You can quickly pass-through whole day at 50x only motion. I takes around 3 minutes, depends on amount of motion. Then, if there is something interesting, you can switch to slower speed and full-length video.

## Browser
Firefox, Chrome and Safari support h264 encoded .mp4 files natively, as well as their mobile counterparts. You just need `<video>` tag in your markup, see /public. If you like, you can use any of nice client side libraries like [Video.js](https://github.com/videojs/video.js). They are not required as well as flash based players, in case only, if you do not need to support outdated browsers.

## Nginx
Best way to serve video files to browser is to use Nginx. Do not even try to do this with Node, it may work but it is wrong. I recommend never using Node for serving static files.

## Node based client side app
This is work in progress. It would be some sort of Admin control panel to manage recording parameters and files.

# Installation
I am planning to prepare an image file of VM with everything installed. Right now only manual installation.

System components
- Linux server
- [motion](http://www.lavrsen.dk/foswiki/bin/view/Motion)
- [ffmpeg](https://www.ffmpeg.org/documentation.html)
- [ffserver](https://www.ffmpeg.org/ffserver.html)
- Node.js 10.x or 12.x
- Nginx

Open ports, setup upstart

# FAQ
- Is it functioning?
  - Yes. Up and running 24/7 with two D-Link DCS-931L web cams from March 2015.
- Required server hardware?
  - Ubuntu 14.04 LTS on virtual machine:  2GB RAM, 120GB SSD HDD, 2 cores of Intel Core i7-2600K.
  - Recoding from one camera takes around 5% of processor time. Processor heavily loaded only during video recompression. It takes around an hour to recompress whole day from one camera.
  - One day after recompression takes around 2GB on hard drive, but due to schedule based cleaning, you need around 50GB for a year history storage from one web cam. You can, of course, manage history and quality of stored files and vastly reduce required hard drive space.
- Can this server run in the cloud environment?
  - Yes, no difference

# TODO
- ISO or Docker image for easy installation
- Sound recording
- Admin UI and remote control
- Alerts
- Screenshots

# License
MIT
