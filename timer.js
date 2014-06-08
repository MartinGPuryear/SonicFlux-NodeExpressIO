//    SonicFlux Node.js server - timer.js
    //
    //  This module implements the setting and executing of periodic recurring
    //  timers, related to the beginning and end of gameplay rounds.
    //

  //  ABOUT SONICFLUX: SCHEDULES, CADENCES AND TIMERS
  //
  //    Overall round schedule
    //
    //  SonicFlux is an application that presents timed quizzes to users.
    //  The system runs synchronously, starting and ending the quizzes for all
    //  clients simultaneously, regardless of difficulty level.
    //
    //  SonicFlux rounds are of fixed length, regardless of difficulty level
    //  or other factors.  Currently this length is exactly three minutes.
    //  Adopting a fixed preset "modulo" schedule (12:00 12:03 12:06 etc.)
    //  theoretically provides all other code immediate transparency into when
    //  rounds start/end.  In practice, though, we cannot take advantage of
    //  this, because we do not want to couple pieces of the system in this
    //  way henceforth.  It's very reasonable to expect our schedule to change
    //  (from 180-second rounds to 150-second, for example) as we get feedback
    //  from users.
    //
  //    Cadence within each round
    //
    //  Each round is comprised of two pieces, in order: a time period of
    //  gameplay, followed by a 'rest' interval.  Conceptually, this latter
    //  period is outside the game room, so internally I refer to these as
    //  Play time and Lobby time.
    //
    //  Within each 180-second round, we spend 150 secs at Play, followed by
    //  30 secs of Lobby.  During this Lobby time, in addition to viewing
    //  final results for that round, players can change rooms (difficulty
    //  levels), view overall leaderboards or player-specific historical
    //  results, etc.   Concurrently, the server commits results to DB and
    //  preps for next round.
    //
  //    Our internal heartbeat
    //
    //  To run this overall schedule, SonicFlux uses a periodic timer that
    //  provides a systemwide 'tick' every 1 second.  This allows us to
    //  provide synchronized 'time remaining' indicators to all clients.
    //  So for example, in a perfect world if a timer fires at 12:00:00,
    //  we know that gameplay for the coming round should start NOW.  A
    //  timer event at 12:02:29 means that 1 second of gameplay remains.
    //  If the timer fires at 12:02:58, we know that 2 seconds of lobby
    //  time remain, at which point the next round will start.
    //
    //  I implement this timer on the Node.js server (not the Rails
    //  server) so as to use Javascript's tighter responsiveness.

    //  Timers are affected by system load, higher-priority interrupts, and
    //  even HW anomalies.  In our case, once a round starts we know exactly
    //  when the timer should be firing, so we are able to adjust the timer
    //  to compensate for any errors that develop.  Depending on the magnitude
    //  of the error, we use two mechanisms to keep our clock timer accurate.
    //
  //    Keeping on our preset schedule
    //
    //  If we discover that our clock timer is inaccurate on the order of
    //  seconds (anything more than .5 secs), we can most easily handle this
    //  by shortening or lengthening our Lobby time interval.  Gameplay must
    //  always use the same interval, but Lobby time could be 25 seconds or
    //  35 seconds, as needed.  If our round just ended, but we realize that
    //  (on our absolute cadence) the next round shouldn't start for 32 secs
    //  instead of 30, we simply add additional seconds to Lobby time.  If our
    //  clock is VERY far ahead, we lengthen the Lobby time by as long as it
    //  takes.  Because this hypothetically could be more than a minute(!), I
    //  may someday add some indicator that this interval is an unusual one.
    //  However, a delay of this magnitude would likely only occur if, for
    //  example, the server went into a low-power sleep state, at which point
    //  the connections with the clients may have dropped anyway.
    //
    //  It is more likely (but still not very likely) that our clock will be
    //  behind, not ahead, by more than .5 secs.  In that case, the most that
    //  we shorten the Lobby time is 9 seconds.  Shortening this even further
    //  would make a surprising user experience even more jarring, plus I may
    //  not have time to finalize the round and prep for the next one if Lobby
    //  time is much shorter.  So if by circumstance we find our central clock
    //  13 seconds behind, the next Lobby time will be abbreviated by 9 secs,
    //  then the next Gameplay round will be exactly as long as expected, then
    //  the next Lobby time will be abbreviated by the remaining 4 seconds.
    //
    //  To recap, when a significant adjustment is needed for our timer to
    //  remain on our preset schedule, we simply add or remove seconds from
    //  the Lobby phase.  Gameplay is never shortened nor lengthened.  The
    //  timer itself continues to fire on its "every second" frequency.
    //
  //    Fine-tuning our internal heartbeat
    //
    //  Because in the future we intend to have exercises that are highly
    //  time-sensitive (e.g. rhythm quizzes), our timer must be very
    //  accurate.  Because even hardware-based clocks can drift over time,
    //  we want the ability to periodically calibrate our timer frequency.
    //  If the timer strays too far from ##:###.000 (as measured by
    //  Date.getTime), we want to be able to change the frequency to bring
    //  it back into synchronization.  We do this by clearing an in-
    //  progress recurring timer, and immediately setting a new one with
    //  a slightly different interval.
    //
    //  Experiments indicate that the best msec interval for a 1.000 sec
    //  recurring timer is actually 990 msec.  Setting the interval to
    //  1000 msec yields a timer that occasionally 'slips' by 16 msec,
    //  whereas striving for 990 msec appears to keep the overall system
    //  on a 1000-msec schedule nicely.  This is NORMAL_TIMER_INTERVAL.
    //
    //  Additionally, although Date.getTime appears to be millisecond-
    //  accurate, Javascript timers nonetheless seem to have a core clock
    //  granularity of approx 16 msec.  System VGA (omnipresent, contains
    //  a hardware clock, refreshes at 60Hz) is likely the root clock.
    //  This puts a lower bound on error thresholds and any fine-tune
    //  frequency adjustments: trying to stay tighter only leads to
    //  hysteresis without improving accuracy.  An error threshold of +/-
    //  10 msec, at which point we fine-tune our timer interval by +/- 14
    //  msec, appears sufficiently responsive while still stable.  This
    //  is reflected in MSECS_MAX_CLK_ERR, and in FAST_TIMER_INTERVAL
    //  (to speed up our clock) and SLOW_TIMER_INTERVAL (to slow down
    //  our clock).
    //
    //  Finally, USE_LARGER_CLOCK_SKEW indicates whether the system
    //  makes even larger timer adjustments, to bring the clock back to
    //  x.000 more quickly.  This is implemented but disabled: even a
    //  maximum clock error of 500 msec can be corrected within 30 secs,
    //  in the absence of some other significant load on the system.
    //  USE_LARGER_CLOCK_SKEW stands ready if ever needed.
    //
  //    Triggered start
    //
    //  As stated earlier, we want our timer to fire every 1 second.
    //  Specifically, we ideally want our timer to fire every 1.000 secs,
    //  at exactly x:xx.000 (i.e., 'x' seconds plus 0 milliseconds).  For
    //  this to happen, in addition to frequency adjustment (see above),
    //  we want to start our timer at just the right time.
    //
    //  Our timer is accurately started by using a one-shot timer to delay the
    //  kickoff of the recurring periodic timer until the exact desired time.
    //  The timer module implements this chaining.  After calculating what
    //  'just the right moment' is, we can trigger a routine to kick off our
    //  recurring timer at that time.  Timer.delayStart implements this
    //  chained kickoff.
    //

module.exports = function Timer(app)
{
  //  Module-wide constants and enums

    SECS_MAX_SKIP_FWD = 9;              //  Max amount we shorten lobby time if needed

    SECS_PER_CALIBRATION = 1;           //  How often do we check the timer accuracy

    USE_LARGER_CLOCK_SKEW = false;

    MSECS_MAX_CLK_ERR = 10;             //  How far from .000, before we adjust timer freq 
    MSECS_EXTRA_MAX_CLK_ERR = 25;       //  Only used if USE_LARGER_CLOCK_SKEW is true

    TimerEnum = {
      TIMER_NOT_SET         : 0,

      FASTER_TIMER_INTERVAL : 960,      //  Only used if USE_LARGER_CLOCK_SKEW is true

      FAST_TIMER_INTERVAL   : 976,
      NORMAL_TIMER_INTERVAL : 990,
      SLOW_TIMER_INTERVAL   : 1004,

      SLOWER_TIMER_INTERVAL : 1020,     //  Only used if USE_LARGER_CLOCK_SKEW is true
    }

  //  Module-wide variables
    var currentTimerInterval = TimerEnum.TIMER_NOT_SET;

    var timerTimeoutObj;                //  Needed to cancel the periodic timer
    var timerIntervalObj;               //  Needed to cancel the oneshot timer
    var secsRemaining = 0;
    var initMSecOffset = -10;           //  One-shots seem to fire 10 msec late

  //    Grab current time, calculate when next game starts, return the diff in msec
  function msecUntilNextGame()
    {
      var now = new Date().getTime();
      var timePrevGameOver = Math.floor(now / MSECS_IN_COMPLETE_CYCLE) * MSECS_IN_COMPLETE_CYCLE;
      return (timePrevGameOver + MSECS_IN_COMPLETE_CYCLE) - now;
    }

  //    This function is the "coarse-tune" mechanism for our cadence timer. 
    //  It lengthens/shortens the lobby interval, to realign us with our intended cadence
    //  Shorten by SECS_MAX_SKIP_FWD at most, or lengthen (bit by bit) as long as it takes!  
  function adjustLobbySecs()
    {
      var actualSecRemaining = parseInt((msecUntilNextGame() + 500)/ 1000);       //  What sec will this cycle end?
      var newSecsRemaining;

      if (actualSecRemaining != secsRemaining)
      {
        newSecsRemaining = Math.max(secsRemaining - SECS_MAX_SKIP_FWD, Math.min(SECS_IN_LOBBY, actualSecRemaining));
          //  Largest skip forward is SECS_MAX_SKIP_FWD; largest skip backwards is to when Lobby begins.  
        console.log("\n *********************************************************");
        console.log("***\tAdjusting lobby time by " + (secsRemaining - newSecsRemaining) + " seconds.\t\t***");
        console.log("***\tsecsRemaining was " + secsRemaining + ", should be " + actualSecRemaining + ", is now " + newSecsRemaining + "\t***");
        console.log(" *********************************************************\n");
        secsRemaining = newSecsRemaining;
      }
    }

  //    Adjust timer frequency as needed to stay on cadence. 
    //  We aim our every-second timer to land exactly on mm:ss.000. If too far off, 
    //  cancel & restart the timer with an adjusted frequency. Empirically, an
    //  interval of 990 ms appears to remain relatively stable.  Notably, the timer
    //  granularity appears capped at 60 Hz; it is likely locked to the video clock
  function calibrateTimer(context)
    {
      var newTimerInterval;
      var now = new Date().getTime();
      var msecClkErr = (now + 500) % 1000 - 500;          //  get our delta from ideal: [-500, 499] msec
      
      newTimerInterval = TimerEnum.NORMAL_TIMER_INTERVAL;

      if (msecClkErr > MSECS_MAX_CLK_ERR)                 //  timer is running a little late
      {
        newTimerInterval = TimerEnum.FAST_TIMER_INTERVAL;
      }
      else if (msecClkErr < -MSECS_MAX_CLK_ERR)           //  timer is running a little early
      {
        newTimerInterval = TimerEnum.SLOW_TIMER_INTERVAL;
      }

      if (USE_LARGER_CLOCK_SKEW)
      {
        if (msecClkErr > MSECS_EXTRA_MAX_CLK_ERR)           //  timer is running late
        {
          newTimerInterval = TimerEnum.FASTER_TIMER_INTERVAL;
        }
        else if (msecClkErr < -MSECS_EXTRA_MAX_CLK_ERR)     //  timer is running early
        {
          newTimerInterval = TimerEnum.SLOWER_TIMER_INTERVAL;
        }
      }

      if (currentTimerInterval != newTimerInterval)
      {
        console.log('\n\t *****************************************************');
        console.log('\t***\t\t\t\t\t\t    ***');
        console.log('\t***\tSetting the new timer interval: ' + newTimerInterval + ' ms\t    ***');
        console.log('\t***\t\t\t\t\t\t    ***');
        console.log('\t *****************************************************\n');

        clearInterval(context.timerIntervalObj);
        context.timerIntervalObj = setInterval(timerTick, newTimerInterval, context);
        currentTimerInterval = newTimerInterval;
      }
    }

  //    Upon starting the periodic timer, this is our initial (oneshot) timer routine. 
    //  Reset secsRemaining if the round just ended.  
    //  Regardless, our 'Play or Lobby?' state needs settting up - call firstXxxTick()
  function firstTick(context)
    {
      if (secsRemaining == 0)
      {
        secsRemaining = SECS_IN_COMPLETE_CYCLE;
      }
      if (secsRemaining <= SECS_IN_LOBBY)
      {
        firstLobbyTick(context);
      }
      else
      {
        firstPlayTick(context);
      }
      logNow('firstTick():\ttimer: ' + currentTimerInterval + 'ms\t' + secsRemaining + '\t');
      secsRemaining--;
    }

  //    Upon first Play tick, perform various player and round-related setup. 
    //  For each player, reset scoreboard and mark as present-at-round-start.
    //  Change the state variable to note that the round has started.  
    //  BROADCAST: 'round_started' with the num of seconds of play.
    //  Then call playTick() as would occur with any other tick.
  function firstPlayTick(context)
    {
      for (var index in all_players_list)
      {
        if (all_players_list[index])
        {
          all_players_list[index].points = 0;
          all_players_list[index].incomplete_round = false;
        }
      }

      round_in_progress = true;
      app.io.broadcast('round_started', (SECS_IN_COMPLETE_CYCLE - SECS_IN_LOBBY));
      logNow('BROADCAST: round_started -- firstPlayTick() timer callback');

      playTick(context);
    }
  
  //    Upon first Lobby tick, perform various player and end-of-round setup. 
    //  Change the state variable to note that the round has ended.
    //  BROADCAST: 'round_ended' with the num of seconds of lobby.
    //  Compile the round's final results, and send them out. 
    //  Then call lobbyTick() as would occur with any other tick.
  function firstLobbyTick(context)
    {
      round_in_progress = false;
      app.io.broadcast('round_ended', SECS_IN_LOBBY);
      logNow('BROADCAST: round_ended -- firstLobbyTick() timer callback ');

      createRoundResults();
      broadcastRoundResults();

      lobbyTick(context);
    }

  //    Overall timer tick function, called every second. 
    //  Depending on seconds remaining, call playTick() or lobbyTick().  Or (if 
    //  time to change between play <=> lobby) call firstXxxTick() instead.
    //  One sec after  lobby time begins, check whether our cadence is out of sync -
    //  if it is, the lobby interval is adjusted to bring the cadence into sync.
    //  In addition to that "coarse" adjustment of 1-sec granularity, pewriodically
    //  perform "fine" adjustment of our timer frequency, to keep our timer firing
    //  exactly every second.  Specifically, adjust its frequency so that it fires
    //  as close as possible to hh:mm:ss.000.  Finally, decrement "seconds left".
  function timerTick(context)
    {
      // logNow('timerTick(): \tsecsRemaining:\t' + secsRemaining + ' \t');
      if (secsRemaining >= SECS_IN_LOBBY)
      {
        playTick(context);
        
        if (secsRemaining == SECS_IN_LOBBY)
        {
          firstLobbyTick(context);
        }
      }
      else if (secsRemaining == SECS_IN_LOBBY - 1)
      {
        adjustLobbySecs();
        lobbyTick(context);
      }
      else
      {
        lobbyTick(context);
        
        if (secsRemaining == 0)
        {
          secsRemaining = SECS_IN_COMPLETE_CYCLE;
          firstPlayTick(context);
        } 
      }

      if ((secsRemaining % (SECS_PER_CALIBRATION)) == 0)
      {
        calibrateTimer(context);
      }
      secsRemaining--;
    }
  
  //    Each play sec, BROADCAST scores and play secs remaining to non-empty rooms. 
    //  Initialize the empty scores array. Put every player's {player_tag, points}
    //  into the array for that room. If room is non-empty, sort the array and 
    //  BROADCAST it to the room, along with the number of play secs remaining.   
  function playTick(context)
    {
      var leaders = [];
      for (var room = MIN_ROOM_NUM; room < MIN_ROOM_NUM+NUM_ROOMS; room++)
      {
        leaders[room] = [];
      }

      for (var index in all_players_list)
      {
        if (all_players_list[index])
        {
          var player = all_players_list[index];
          leaders[player.diff_lvl].push( { player_tag: player.player_tag, points: player.points } );
        }
      }
      for (var room = MIN_ROOM_NUM; room < MIN_ROOM_NUM+NUM_ROOMS; room++)
      {
        if (roomCount[room]) 
        {
          leaders[room].sort( function(a,b) { return b.points - a.points; });

          var playTickInfo = {};
          playTickInfo['time_remaining'] = secsRemaining - SECS_IN_LOBBY;
          playTickInfo['leaders'] = leaders[room];
          
          app.io.room('' + room).broadcast('play_timer_update', playTickInfo);
          
          if (currentTimerInterval != TimerEnum.NORMAL_TIMER_INTERVAL)
          {
            logNow('BROADCAST [' + room + ']: play_timer_update - ' + playTickInfo['time_remaining'] + '\t');
          }
        }
      }
    }
  
  //    Each lobby sec, BROADCAST 'lobby_timer_update' w/ secs remaining to non-empty rooms. 
  function lobbyTick(context)
    {
      for (var room = MIN_ROOM_NUM; room < MIN_ROOM_NUM+NUM_ROOMS; room++)
      {
        if (roomCount[room]) 
        {
          app.io.room('' + room).broadcast('lobby_timer_update', secsRemaining);

          if (currentTimerInterval != TimerEnum.NORMAL_TIMER_INTERVAL)
          {
            logNow('BROADCAST [' + room + ']: lobby_timer_update - ' + secsRemaining + '\t');
          }
        }
      }
    }
  
  //    Upon end of round, put each {player_tag, points} into the array for that diff_lvl. 
  function createRoundResults()
    {
      for (var room = MIN_ROOM_NUM; room < MIN_ROOM_NUM+NUM_ROOMS; room++)
      {
        round_results[room] = [];
      }

      for (var index in all_players_list)
      {
        if (all_players_list[index])
        {
          var player = all_players_list[index];
          round_results[player.diff_lvl].push( { player_tag: player.player_tag, points: player.points } );
        }
      }
    }
  
  //    Upon end of round, sort and BROADCAST the round_results to each non-empty room. 
  function broadcastRoundResults()
    {
      for (var room = MIN_ROOM_NUM; room < MIN_ROOM_NUM+NUM_ROOMS; room++)
      {
        if (roomCount[room] && round_results[room].length)
        {
          round_results[room].sort( function(a,b) { return b.points - a.points; });
          app.io.room('' + room).broadcast('room_round_results', round_results[room]);
          logNow('BROADCAST [' + room + '] room_round_results - \t' + round_results[room]);
        }
      }
    }
  
  //    The one-time routine that executes an initial callback & sets our recurring timer. 
  function oneShot(firstCallback, callback, interval, context)
    {
      logNow("oneShot():");
      firstCallback(context);
      context.timerIntervalObj = setInterval(callback, interval, context);
    };
  
  //    Set a one-shot to fire at a specified time (which in turn sets a periodic timer). 
    //  Parameters: the one-time initial delay and initial ("one=shot" routine, plus the 
    //  periodically executed routine, periodicity interval and context 
  function delayStart(firstCallback, delay, callback, interval, context)
    {
      logNow("\ndelayStart(): delay=" + delay + " interval=" + interval);
      context.timerTimeoutObj = setTimeout(oneShot, delay, firstCallback, callback, interval, context);
    };
  
  //    Generic log function that includes a formatted timestamp. 
  function logNow(prefixStr)
    {
      var now = new Date().getTime();

      console.log(prefixStr, (parseInt(now / 3600000) % 24) + ':' + ('0'+(parseInt(now / 60000) % 60)).slice(-2) + ':' + ('0'+(parseInt(now / 1000) % 60)).slice(-2) + '.' + ('00'+(now % 1000)).slice(-3));
      return now;
    }

  return  {

    //    Trigger-start off a periodic timer after calculating where we are in time. 
      //  Specifically, determine how many milliseconds to delay, and set a 
      //  one-shot timer to fire at that time. Set secsRemaining as well. 
      //  The one-shot timer exists to set an every-second periodic timer, 
      //  which is initially set to the default interval.
    start: function start()
      {
        var msecsRemaining = msecUntilNextGame();
        secsRemaining = parseInt(msecsRemaining / 1000);
        msecsRemaining %= 1000;

        delayStart(firstTick, msecsRemaining + initMSecOffset, 
                   timerTick, TimerEnum.NORMAL_TIMER_INTERVAL, 
                   (this));
        currentTimerInterval = TimerEnum.NORMAL_TIMER_INTERVAL;
      },

    //    Cancel any in-progress one-shot & recurring timers; clear the current interval. 
    stop: function stop()
      {
        clearTimeout(timerTimeoutObj);
        clearInterval(timerIntervalObj);
        currentTimerInterval = TimerEnum.TIMER_NOT_SET;        
      }
  };
}
