//    SonicFlux Node.js server - app.js
  //
  //  This file configures the overall Node.js server and loads
  //  other modules.  Most code resides in timer.js & route.js.
  //

var express = require('express.io');
var path = require('path');
var app = express().http().io();
var port = 6789;

    //    configure our environment
app.configure(function()
  {
    app.use(express.cookieParser());  

        //    handle POST data
    app.use(express.urlencoded());
    app.use(express.json());

        //    handle static contents
    app.use(express.static(path.join(__dirname, 'public')));

        //    session support enabled.
    app.use(express.session({secret: 'peach'}));

    app.set("view engine", "ejs");

    // experimenting, to isolate a 'failure to connect' issue...
      // app.set("transports", [ "websocket", "xhr-polling" ]);
      // app.set("polling duration", 10);
      // app.set("close timeout");
    
    app.set("log level", 3);
  });

(function()
  {

  //    Constants shared by Timer and Routes modules.

    //  See timer.js for time-related documentation
    SECS_IN_LOBBY = 30;
    SECS_IN_COMPLETE_CYCLE = 180;
    MSECS_IN_COMPLETE_CYCLE = SECS_IN_COMPLETE_CYCLE * 1000;

    //  See route.js for room-related documentation
    MIN_ROOM_NUM = 0;
    NUM_ROOMS = 4;

  //    Variables shared by Timer and Routes modules.
    roomCount = [];
    for (var i = MIN_ROOM_NUM; i < (MIN_ROOM_NUM + NUM_ROOMS); i++)
    {
      roomCount[i] = 0;
    }

    all_players_list = {};
    round_in_progress = false;
    round_results = [];

  //    /timer.js handles setting and executing all periodic recurring timers
    var timer = require('./timer.js')(app);
    timer.start();
      
  //    /routes/index.js handles all routing and rooms
    var route = require('./routes/route.js')(app);
  }())

app.listen(port);

console.log('\n ***************************************************');
console.log('*****                                           *****');
console.log('*****   Express server listening on port ' + port + '   *****');
console.log('*****                                           *****');
console.log(' ***************************************************\n');
