const EE = require("events");
const net = require("net");

const HeosClient = params => {
  let self = new EE();
  self.host = params.host;
  self.port = params.port;
  const client = net.createConnection(
    { host: self.host, port: self.port },
    () => {
      console.log("connected to server!");
      self.emit("ready");
    }
  );
  client.on("data", data => {
    console.log(data.toString());
    let dataArr = data.toString().split("\n");
    const processData = dataStr => {
      try {
        let dataObj = JSON.parse(dataStr);
        // check if valid response
        if (typeof dataObj !== "object") {
          return;
        }
        if (!dataObj.hasOwnProperty("heos")) {
          return;
        }
        // emit to listeners
        self.emit("response", dataObj);
      } catch (e) {
        //console.log("error parsing incoming message from HEOS: " + e.message);
      }
    };
    dataArr.forEach(processData);
  });
  client.on("end", () => {
    console.log("disconnected from heos");
  });
  self.request = cmd => {
    client.write("heos://" + cmd + "\r\n");
  };

  return self;
};

// register client
let h = HeosClient({ host: "10.0.42.15", port: 1255 });
// player id
let globalPID = 0;
// station list
let globalStations = [];
// current station index
let globalStationIndex = 0;
// mute state
let globalMuted = false;

// register listener for incoming response from HEOS
h.on("response", res => {
  // if player list was received
  if (
    res.heos.command === "player/get_players" &&
    res.hasOwnProperty("payload")
  ) {
    console.log("got players: ", res.payload);
    // for simplicity assume only one player in system
    globalPID = res.payload[0].pid;
    console.log(globalPID);
  }
  // if list of stations was received save it to global variable
  if (res.heos.command === "browse/browse" && res.hasOwnProperty("payload")) {
    console.log("browse/browse response");
    let sid = 0;
    // parse message, so, got sid
    let msgArr = res.heos.message.split("&");
    msgArr.forEach(t => {
      console.log(t);
      if (t.indexOf("sid") > -1) {
        // add sid to each entry
        sid = parseInt(t.split("=")[1]);
      }
    });
    res.payload.forEach(t => {
      if (!t.sid) {
        t.sid = sid;
      }
      if (t.type === "station") {
        globalStations.push(t);
      } else if (t.type === "heos_service") {
        // for aux inputs I get heos_service type
        // in this case browse recursevely
        h.request("browse/browse?sid=" + t.sid);
      }
    });
    console.log("globalstations: ", globalStations);
  }
});

// finally, when socket is opened
h.on("ready", _ => {
  h.request("system/check_account");
  // if authorization is required uncomment and put your credentials
  //h.request("system/sign_in?un=<usernameORemail>&pw=<passwrd>");

  // to get player id
  h.request("player/get_players");
  // browse favorites
  h.request("browse/browse?sid=" + 1028);
  // aux
  h.request("browse/browse?sid=" + 1027);
});

// now KNX part
const Dobaos = require("dobaos.js");

const dobaos = Dobaos();

const DP_PREVNEXT = 41;
const DP_PLAYSTOP = 42;
const DP_MUTE = 43;
const DP_VOLUME = 44;

const processBaosValue = payload => {
  if (Array.isArray(payload)) {
    return payload.forEach(processBaosValue);
  }

  let { id, value } = payload;
  let cmd, state;
  switch (id) {
    case DP_PREVNEXT:
      if (globalStations.length === 0) {
        // if no favorites configured, do nothing
        return;
      }
      // if value===true then next, else - prev station
      if (value) {
        if (globalStationIndex < globalStations.length - 1) {
          globalStationIndex += 1;
        } else {
          globalStationIndex = 0;
        }
      } else {
        // prev
        if (globalStationIndex > 0) {
          globalStationIndex -= 1;
        } else {
          globalStationIndex = globalStations.length - 1;
        }
      }
      let station = globalStations[globalStationIndex];
      // send play req
      cmd = "browse/play_stream";
      cmd += "?pid=" + globalPID;
      cmd += "&sid=" + station.sid;
      cmd += "&mid=" + station.mid;
      h.request(cmd);

      break;
    case DP_PLAYSTOP:
      // send play req
      cmd = "player/set_play_state";
      cmd += "?pid=" + globalPID;
      if (value) {
        // play
        state = "play";
      } else {
        // stop
        state = "stop";
      }
      cmd += "&state=" + state;
      h.request(cmd);
      break;
    case DP_MUTE:
      cmd = "player/set_mute";
      cmd += "?pid=" + globalPID;
      if (value) {
        // mute
        state = "on";
      } else {
        // unmute
        state = "off";
      }
      cmd += "&state=" + state;
      h.request(cmd);
      break;
    case DP_VOLUME:
      // scale from 0-255 to 0-100
      const value100 = Math.floor((value * 100) / 255);
      // set volume request
      cmd = "player/set_volume";
      cmd += "?pid=" + globalPID;
      cmd += "&level=" + value100;
      h.request(cmd);
      break;
    default:
      break;
  }
};
dobaos.on("datapoint value", processBaosValue);

dobaos.init();
