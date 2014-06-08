//    SonicFlux Node.js server - route.js
    //
    //  This module implements the routing of node/socket messages -
    //  receiving, responding, broadcasting.  It also handles the
    //  joining and detaching of clients to specific rooms.  Additionally,
    //  it tracks the per-room scoreboard that is sent every second to all
    //  clients in the room, as well as the final results sent out at round's
    //  end.  Finally, it serves out a simple client page that can be used for
    //  diagnostic purposes.

  //  ABOUT SONICFLUX: CONNECTIONS, ROOMS, ROUNDS, SCORES
  //
  //    Client connections to the Node.js server
  //
    //  Each client initiates a connection to the server by the EMIT of
    //  'client_ready', with the user's tag and difficulty level.
    //
    //  If input is not well-formed, server will EMIT 'error_client_ready' to
    //  indicate that client must resend compliant data.  If the client input
    //  is well-formed, server will EMIT 'client_confirmed'.
    //
    //  When a client closes the tab or navigates elsewhere, its socket.io
    //  client will automatically EMIT a 'disconnect' msg to the server.
    //
  //    Rooms and difficulty levels
  //
    //  When a client is confirmed, the server responds with three actions.
    //  First, it will JOIN the client to the requested room, and BROADCAST
    //  the 'gamer_entered_room' notification to others in the room.
    //  Second, it will EMIT 'gamers_already_in_room' to the client, along
    //  with the rest of the current state of the room (scores). Third, it
    //  will EMIT to the client the messages needed to set its Game state
    //  ('round_started', 'round_ended', 'room_round_results') - more on those
    //  msgs in the next section.
    //
    //  The actions taken upon a 'disconnect' should mirror those taken when a
    //  client is confirmed.  The server will detach (LEAVE) the client from
    //  its room and BROADCAST 'gamer_exited_room' to remaining clients there.
    //
    //  The 'change_room' message is not yet fully implemented, but will
    //  effectively function similar to 'disconnect'+'client_ready' with
    //  regard both to exiting the first room (LEAVE+'gamer_exited_room' &
    //  'round_ended'+'final_round_score') and to entering the second one
    //  (JOIN+'gamer_entered_room'+'gamers_already_in_room', plus either
    //  'round_started' or 'round_ended'+'room_round_results').
    //
    //  One detail to mention: a room value of 0 is evidently invalid!
    //  Messages sent to room 0 are received by all clients, even those
    //  not joined to any room.  For this reason, I use the room values
    //  '0'..'3' -- specifically using character '0' instead of value 0.
    //  Works great!  Interesting problem to debug.
    //
  //    Gameplay rounds and scoring
  //
    //  During gameplay, clients will EMIT 'player_scored' in
    //  response to a change in their score (as decided by the Rails server).
    //  The Node server will either update the player's score (sent out to
    //  the room each second, see below) or notify client of malformed data
    //  with EMIT of'error_unrecognized_player' or 'error_player_scored'.
    //
    //  The server will BROADCAST 'round_started' and 'round_ended' to notify
    //  clients, at which point the client UI changes to Play or Lobby modes,
    //  respectively.  Upon round end, client EMITs 'request_final_score'; in
    //  response, server EMITs that client's 'final_round_score'.
    //
  //    In-round scoreboard and post-round leaderboard
  //
    //  The Node server sends a heartbeat of sorts to all rooms every second.
    //  During gameplay, the server BROADCASTs a 'play_timer_update' to
    //  each room, along with that room's scoreboard.  Each Client is
    //  expected to update its UI with the time remaining and the scoreboard.
    //  Conversely, during Lobby time the BROADCAST 'lobby_timer_update'
    //  indicates to all clients the time remaining before next round starts.
    //  When the round ends, the server will BROADCAST 'room_round_results' to
    //  the room, with the room's final scores for that round.
    //
    //  During Play, the 'play_timer_update' BROADCAST contains a list of the
    //  room's players (along with their current scores).  This is something
    //  each client must also maintain by tracking 'gamers_already_in_room',
    //  'gamer_entered_room' and 'gamer_exited_room' messages, because in
    //  Lobby mode clients display a players-in-room list for coming round.
    //
  //    Diagnostics client
  //
    //  For debugging purposes, a simple client is built into this project,
    //  an index.ejs that is served out in response to a '/' URL request.
    //  The client responds to, and sends, all of the socket/node messages
    //  needed to exercise the server.
    //

module.exports = function Route(app)
{
  var num_guests = 0;

//  Worker functions

  //    What difficulty level did this client specify? 
    //  Upon 'client_ready', parse request to extract a difficulty level:
    //  an integer value between [MIN_ROOM_NUM, MIN_ROOM_NUM + NUM_ROOMS]. 
    //  Includes hardening against malformed requests: EMITs 'error_client_ready'
  function determineDifficultyLevel(request)
    {
      if (!request.data)            //  covers the undefined/null/0/''/false cases
      {
        request.io.emit('error_client_ready', {error_str: "No request data was provided", user_input: '' });
        console.log('EMIT: error_client_ready (No request data was provided)'); 
        return -1;
      }
      if (!request.data.profile)    //  covers the undefined/null/0/''/false cases
      {
        request.io.emit('error_client_ready', {error_str: "No user profile was provided", user_input: '' });
        console.log('EMIT: error_client_ready (No user profile was provided)'); 
        return -1;
      }
      if ((typeof(request.data.profile.difficulty_level) == 'undefined') || (request.data.profile.difficulty_level == null))
      {
        request.io.emit('error_client_ready', {error_str: "No difficulty level was provided", user_input: '' });
        console.log('EMIT: error_client_ready (No difficulty level was provided)'); 
        return -1;
      }

      var diff_lvl = parseInt(request.data.profile.difficulty_level);
      if (isNaN(diff_lvl))
      {
        request.io.emit('error_client_ready', {error_str: "Invalid difficulty level", user_input: request.data.profile.difficulty_level });
        console.log('EMIT: error_client_ready (Invalid difficulty level)'); 
        return -1;
      }
      if ((diff_lvl < MIN_ROOM_NUM) || (diff_lvl >= MIN_ROOM_NUM + NUM_ROOMS))
      {
        request.io.emit('error_client_ready', {error_str: "Difficulty level is out of range", user_input: request.data.profile.difficulty_level });
        console.log('EMIT: error_client_ready (Difficulty level is out of range)'); 
        return -1;
      }
      return diff_lvl;
    }

  //    Is client already connected on separate tab? 
    //  Upon 'client_ready', check whether this client (this Session ID) is
    //  already connected. If so, just increment a refcount. 
  function checkClientAlreadyConnected(request)
    { 
      if (all_players_list[request.sessionID] != null)
      {
        request.session.player = all_players_list[request.sessionID];
        request.session.player['ref_count']++;
        console.log("This session (client " + request.session.player.player_tag + ") is already connected. Increasing refcount to " + request.session.player['ref_count']);
        return true;
      }
      return false;
    }

  //    What 'player tag' did this client specify? 
    //  Upon 'client_ready', parse request to extract a player's tag. If no
    //  tag is supplied (undefined/null/empty-string), create a 'Guest' tag.
  function determineTag(request)
    {
      var tag = request.data.profile.player_tag;
      if ((typeof(tag) == 'undefined') || (tag == null) || (tag.trim() == ''))
      {
        tag = 'Guest ' + num_guests;
        num_guests++;
      }
      tag = tag.trim();
      return tag;
    }

  //    Join the player to the room and announce to everyone else. 
    //  Upon 'client_ready', after parsing request into tag and diff_lvl, 
    //  JOIN player to the appropriate room. Also, notify others in the room 
    //  about this player's arrival, via ROOM.BROADCAST of 'gamer_entered_room'.
  function attachPlayerToRoom(request, player)
    {
      roomCount[player.diff_lvl]++;
      request.io.join(player.diff_lvl);
      console.log('JOIN [' + player.diff_lvl + '] (' + player.player_tag + '): roomCount=', roomCount[player.diff_lvl]);

      request.io.room('' + player.diff_lvl).broadcast('gamer_entered_room', { player_tag: player.player_tag, points: player.points } );
      console.log('BROADCAST [' + player.diff_lvl + ']: gamer_entered_room -- ' + player.player_tag ); 
    }

  //    Send list of players already in room. 
    //  Upon 'client_ready', after joining player to the room, create & EMIT a
    //  list of players already joined - 'gamers_already_in_room'
  function emitPlayersAlreadyInRoom(request, player)
    {
      var gamers = [];
      for (var index in all_players_list)
      {
        if (all_players_list[index] && (all_players_list[index].diff_lvl == player.diff_lvl))
        {
          gamers.push( { player_tag: all_players_list[index].player_tag, points: all_players_list[index].points } );
        }
      }
      request.io.emit('gamers_already_in_room', {leaders: gamers} );
      console.log('EMIT (' + player.player_tag + '): gamers_already_in_room'); 
    }

  //    Send round_start or [round_end + final results]. 
    //  Upon 'client_ready', after providing a list of other players present, EMIT
    //  'round_started' / 'round_ended' to sync the client to our current state. 
    //  If round is over, also EMIT 'room_round_results' with previous results.
  function emitRoundEventAndResults(io, round_in_progress, room)
    {
      if (round_in_progress)
      {
        io.emit('round_started', (SECS_IN_COMPLETE_CYCLE - SECS_IN_LOBBY));
        console.log('EMIT: round_started');
        return;
      }

      io.emit('round_ended', SECS_IN_LOBBY);
      console.log('EMIT: round_ended');

      if (round_results[room].length)
      {
        io.emit('room_round_results', round_results[room]);
        console.log('EMIT: room_round_results - \t' + round_results[room]);
      }
    }

  //    Exit player from the room and annouce to everyone else. 
    //  Upon 'disconnect' after checking for undefined or duplicate session,  
    //  decr the appropriate roomCount and LEAVE the room. If others are in
    //  the room, ROOM.BROADCAST 'gamer_exited_room' to notify them.
  function detachPlayerFromRoom(request)
    {
      var diff_lvl = request.session.player.diff_lvl;
      var tag = request.session.player.player_tag;

      roomCount[diff_lvl]--;
      request.io.leave(diff_lvl);
      console.log('LEAVE [' + diff_lvl + '] (' + tag + '): roomCount=' + roomCount[diff_lvl] );
      
      if (roomCount[diff_lvl] > 0)
      {
        var player = { player_tag: tag };
        request.io.room('' + diff_lvl).broadcast('gamer_exited_room', player );
        console.log("BROADCAST [" + diff_lvl + "]: gamer_exited_room (" + tag + ")");
      }
      else
      {
        console.log("...not BROADCASTing, since room [" + diff_lvl + "] is empty");
      }
    }


//  Routing functions

  //    RECEIVE: 'client_ready' upon initial client connect. 
    //  Extract diff_lvl & tag. If already connected, increment refcount & exit.
    //  Else, add player to all_players_list. EMIT 'client_confirmed' to Ack the 
    //  connection and whether round-in-progress (incomplete_round => TRUE). Join
    //  to room, send list of players already present, send round_start/round_end 
    //  event. If round_end, send previous round's results. 
  app.io.route('client_ready', function(request)
    { 
      console.log('RECEIVED: client_ready'); 

      var diff_lvl = determineDifficultyLevel(request);
      if (diff_lvl == -1)                   //  -1 signifies the error case
        return;                             //  if so, error messages are already set
      if (checkClientAlreadyConnected(request))
        return;                             //  connected, so setup already done 
      var tag = determineTag(request);

      player = {player_tag: tag, points: 0, diff_lvl: diff_lvl, incomplete_round: round_in_progress, ref_count: 1 };
      all_players_list[request.sessionID] = player;
      console.log('Client connected: ' + player.player_tag + ', sessionID ' + request.sessionID);

      request.session.player = player;
      request.io.emit('client_confirmed', player);
      console.log('EMIT (' + player.player_tag + '): client_confirmed - room=' + player.diff_lvl + ', incomplete_round=' + player.incomplete_round); 

      attachPlayerToRoom(request, player);
      emitPlayersAlreadyInRoom(request, player);
      emitRoundEventAndResults(request.io, round_in_progress, diff_lvl);
      
      console.log("exiting client_ready(): all_players_list: \n", all_players_list)
    });

  //    RECEIVE: 'change_room' when client decides to change difficulty_level. 
    //  In essence, this combines 'disconnect' and 'client_ready', without 
    //  an actual removal from the global players list. 
    //  Extract diff_lvl and correlate to existing session/player/diff_lvl.
    //  If same level as before, do absolutely nothing and return. 
    //  Otherwise, do the following:
    //  - LEAVE the room and decr roomCount. 
    //  - EMIT final results for the round (perhaps incomplete). 
    //  - If others are still in the room, ROOM.BROADCAST 'gamer_exited_room'.
    //  - Change the diff_lvl for this user in the all_players_list. 
    //  - JOIN the player to the new room.
    //  - EMIT the list of players already present in the new room.
    //  - EMIT round_start or round_end
    //  - If Lobby time, send previous round's results. 
  app.io.route('change_room', function(request)
    {
      console.log('RECEIVED: change_room');

      //  Extract diff_lvl.
      new_level = determineDifficultyLevel(request);
      if (new_level == -1)
        return;

      //  Correlate to existing session/player/diff_lvl.
      prev_level = player.diff_lvl;
      console.log('player (from all_players_list):' + all_players_list[request.sessionID]);
      console.log('player (from session):' + request.session.player);
      player = request.session.player;

      //  If same level as before, do absolutely nothing and return. 
      if (new_level == prev_level)
        return;

      //  Otherwise, do the following:

      //  - LEAVE the room and decr roomCount. 
      //  - If others are still in the room, ROOM.BROADCAST 'gamer_exited_room'.
      detachPlayerFromRoom(request);

      //  - Change the diff_lvl for this user in the all_players_list. 
      player.diff_lvl = new_level;
      console.log('(after update) player (from all_players_list):' + all_players_list[request.sessionID]);
      console.log('(after update) player (from session):' + request.session.player);

      //  - JOIN the player to the new room.
      attachPlayerToRoom(request, player);

      //  - EMIT the list of players already present in the new room.
      emitPlayersAlreadyInRoom(request, player);

      //  - EMIT final results for the round (perhaps incomplete). 
      //  - EMIT round_start or round_end
      //  - If Lobby time, send previous round's results. 
      emitRoundEventAndResults(request.io, round_in_progress, prev_level)
    });

  //    RECEIVE: 'disconnect' when client closes tab or navigates elsewhere. 
    //  If undefined session.player (e.g. client connects, server restarts, client 
    //  disconnects), just exit. Else, decr ref_count (multiple instances of the
    //  session might be connected). If ref_count==0, LEAVE room, decr roomCount, 
    //  remove from all_players list. If others are still in room, ROOM.BROADCAST 
    //  'gamer_exited_room'. Null out session.player & session.
  app.io.route('disconnect', function(request)
    {
      if (request.session.player === undefined)
      {
        console.log("RECEIVED: disconnect (undefined?) - all_players_list: ", all_players_list);
        return;
      }
      console.log("RECEIVED: disconnect (" + request.session.player.player_tag + ")");

      if (--request.session.player['ref_count'])
      {
        console.log('Gamer ref_count was > 1. Decrementing but staying connected.');
        return;
      }

      detachPlayerFromRoom(request);      
      all_players_list[request.sessionID] = null;
      console.log("all_players_list: ", all_players_list)

      request.session.player = null;
      request.session = null;
    });
  
  //    RECEIVE: 'player_scored' when client notifies us their score has changed. 
    //  Validate session/player/points & data/points. Only accept new score if 
    //  round is in progress. Update the session.player and all_player_list.
  app.io.route('player_scored', function(request)
    {
      console.log("player_scored ...");
      if (!request.session)               //  covers undefined/null/0/''/false cases
      {
        console.log("... but session not set");
        request.io.emit('error_unrecognized_player', {error_str: "session is not set"});
        return;
      }
      if (!request.session.player)        //  covers undefined/null/0/''/false cases
      {
        console.log("... but player not set");
        request.io.emit('error_unrecognized_player', {error_str: "session.player is not set"});
        return;
      }
      if (!request.data)                  //  covers undefined/null/0/''/false cases
      {
        console.log("... but request.data not set");
        request.io.emit('error_player_scored', {error_str: "request.data is not set"});
        return;
      }
      if (request.data.points == null)    //  covers undefined/null cases
      {
        console.log("... but request.data.points not set");
        request.io.emit('error_player_scored', {error_str: "request.data.points is not set"});
        return;
      }

      if (round_in_progress)
      {
        request.session.player.points = request.data.points;
        all_players_list[request.sessionID].points = request.data.points;
      }
      else
      {
        console.log("... but we're currently in lobby time. Ignoring this msg.");
        if (request.session.player.points == null)  //  covers undefined/null cases
        {                                  
          console.log("request.session.player.points was null, setting to 0");
          request.session.player.points = 0;        //  OK to continue: non-fatal (but curious)
        }
      }
    });
  
  //    RECEIVE: 'request_final_score' when client requests his final score. 
    //  Validate session/player, returning same error as 'player_scored' if these
    //  are malformed. Else, return points, and whether round-in-progress. 
  app.io.route('request_final_score', function(request)
    {
      if (!request.session)               //  covers undefined/null/0/''/false cases
      {
        console.log("request_final_score, but session not set");
        request.io.emit('error_unrecognized_player', {error_str: "session is not set"});
        return;
      }
      if (!request.session.player)        //  covers undefined/null/0/''/false cases
      {
        console.log("request_final_score, but player not set");
        request.io.emit('error_unrecognized_player', {error_str: "session.player is not set"});
        return;
      }

      var gamer = request.session.player;
      if (round_in_progress)
      {
        console.log("request_final_score received while round is still in progress");
        gamer.incomplete_round = true;
      }
      request.io.emit('final_round_score', { points: gamer.points, round_complete: !(gamer.incomplete_round) });
      console.log("request_final_score -- points:" + gamer.points + ", round_complete:" + !(gamer.incomplete_round));
    });
  
  //  GET: ROOT is only used by the NODE text client. Render the simple view. 
  app.get('/', function(request, response)
    {
      response.render('index', { title:'Node client', default_room: MIN_ROOM_NUM });
      console.log("\n*****Rendering index");
      return;
    });
  
};
