import mqtt from 'mqtt'
import EventEmitter from 'events'
import redisClient from './config/redis.js'
import {
  humidityRepository,
  temperatureRepository,
  motionRepository,
  nodeBEventRepository,
} from './config/redisRepository.js'

const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'

const connectOptions = {
  clientId: `node-client-${Math.random().toString(16).slice(2)}`,
  clean: true,
  reconnectPeriod: 2000,
  connectTimeout: 30 * 1000,
  protocolVersion: 4,      // Use MQTT 3.1.1 (standard)
  handshakeTimeout: 20000, // Allow more time for initial handshake on RPi
}

const pubClient = mqtt.connect(brokerUrl, { ...connectOptions, clientId: `node-pub-${Math.random().toString(16).slice(2)}` })
const subClient = mqtt.connect(brokerUrl, { ...connectOptions, clientId: `node-sub-${Math.random().toString(16).slice(2)}` })

// --- SMART OFFICE DECISION ENGINE ---
const COMMAND_TOPIC = 'office/commands/node_b';
const activeZones = { 1: null, 2: null, 3: null };
const zoneOffTimestamps = { 1: null, 2: null, 3: null };
const MOTION_TIMEOUT = 5000; // 5 seconds timeout for LEDs
let currentTemp = 24.0;
let presentationMode = false;

export function getPresentationMode() {
  return presentationMode;
}

export function setPresentationMode(state) {
  if (presentationMode === state) return;
  presentationMode = state;
  if (presentationMode) {
    console.log('[Smart Logic] Presentation Mode ON. Dimming office.');
    sendCommand('LED_1', 'OFF');
    sendCommand('LED_2', 'OFF');
    sendCommand('LED_3', 'OFF');
    sendCommand('AC', 'SLOW');
  } else {
    console.log('[Smart Logic] Presentation Mode OFF. Resuming auto-sensors.');
    updateAC();
  }
}

export const deviceOverrides = {
  AC: null,
  LED_1: null,
  LED_2: null,
  LED_3: null
};

export const nodeStatus = {
  node_a: 'offline',
  node_b: 'offline',
  server: 'online'
};

function sendCommand(device_id, command) {
  if (deviceOverrides[device_id]) return; // Blocked by override
  publishSensorData(COMMAND_TOPIC, { device_id, command });
}

function evaluateSmartRules(payload) {
  // 1. Presentation Mode Logic
  if (payload.type === 'mode' && payload.status === 'presentation') {
    setPresentationMode(!presentationMode);
    return;
  }

  if (presentationMode) return; // Ignore auto-sensors while presenting

  // 2. Motion Logic (5-second timeout)
  if (payload.type === 'periodic_motion' && payload.states) {
    let roomJustOccupied = false;

    for (let i = 1; i <= 3; i++) {
      const isMotion = payload.states[`zone_${i}`];
      if (isMotion) {
        roomJustOccupied = true;

        if (zoneOffTimestamps[i]) {
          const timeOffMs = Date.now() - zoneOffTimestamps[i];
          const hours = timeOffMs / (1000 * 60 * 60);
          if (hours > 0) {
            redisClient.incrByFloat('analytics:time_saved_hours', hours).catch(e => console.error(e));
          }
          zoneOffTimestamps[i] = null;
        }

        sendCommand(`LED_${i}`, 'ON');
        
        // Clear existing timer and start a new 5-second countdown
        if (activeZones[i]) clearTimeout(activeZones[i]);
        activeZones[i] = setTimeout(() => {
          console.log(`[Smart Logic] Zone ${i} empty for 5s. Turning OFF.`);
          sendCommand(`LED_${i}`, 'OFF');
          activeZones[i] = null; 

          // Ghost occupancy tracked
          redisClient.incr('analytics:ghost_events').catch(e => console.error(e));
          zoneOffTimestamps[i] = Date.now();

          checkOverallOccupancy();
        }, MOTION_TIMEOUT);
      }
    }
    if (roomJustOccupied) updateAC();
  }

  // 3. Climate Logic Update
  if (payload.type === 'climate' && payload.temp !== undefined) {
    currentTemp = payload.temp;
    updateAC();
  }
}

function checkOverallOccupancy() {
  const isOccupied = Object.values(activeZones).some(timer => timer !== null);
  if (!isOccupied && !presentationMode) {
    console.log('[Smart Logic] Entire office is empty. AC Auto-OFF.');
    sendCommand('AC', 'OFF');
  }
}

function updateAC() {
  if (presentationMode) return;
  
  const isOccupied = Object.values(activeZones).some(timer => timer !== null);
  if (!isOccupied) return; // Do nothing if room is empty, checkOverallOccupancy handles the OFF command

  // AC stays SLOW below 25, goes FAST at 25 and above
  let acCommand = currentTemp > 25.5 ? 'FAST' : 'SLOW';
  sendCommand('AC', acCommand);
}
export function reevaluateState() {
  if (presentationMode) {
    publishSensorData(COMMAND_TOPIC, { device_id: 'LED_1', command: deviceOverrides['LED_1'] || 'OFF' });
    publishSensorData(COMMAND_TOPIC, { device_id: 'LED_2', command: deviceOverrides['LED_2'] || 'OFF' });
    publishSensorData(COMMAND_TOPIC, { device_id: 'LED_3', command: deviceOverrides['LED_3'] || 'OFF' });
    publishSensorData(COMMAND_TOPIC, { device_id: 'AC', command: deviceOverrides['AC'] || 'SLOW' });
    return;
  }
  
  for (let i = 1; i <= 3; i++) {
    const state = deviceOverrides[`LED_${i}`] || (activeZones[i] ? 'ON' : 'OFF');
    publishSensorData(COMMAND_TOPIC, { device_id: `LED_${i}`, command: state });
  }
  
  const isOccupied = Object.values(activeZones).some(timer => timer !== null);
  let acCmd = 'OFF';
  if (isOccupied) {
    acCmd = currentTemp > 25.5 ? 'FAST' : 'SLOW';
  }
  publishSensorData(COMMAND_TOPIC, { device_id: 'AC', command: deviceOverrides['AC'] || acCmd });
}

// --- END SMART OFFICE DECISION ENGINE ---

subClient.on('connect', () => {
  console.log('[MQTT SUB] connected to broker', brokerUrl)
  const topics = ['smartoffice/sensors', 'smartoffice/#', 'redis/#', 'node_b/#', 'office/#']
  subClient.subscribe(topics, { qos: 0 }, (err, granted) => {
    if (err) {
      console.error('[MQTT SUB] subscribe error', err)
      return
    }
    console.log('[MQTT SUB] subscribed to', granted.map((g) => g.topic).join(', '))
  })
})

async function saveToRedis(topic, payload) {
  const ts = new Date() // Force server time since external nodes may lack RTCs and have unsynced clocks.
  let saved = false

  if (payload.temperature !== undefined || payload.temp !== undefined) {
    const tempValue = payload.temperature !== undefined ? payload.temperature : payload.temp
    await temperatureRepository.save({ temperature: Number(tempValue), timestamp: ts })
    saved = true
  }
  if (payload.humidity !== undefined) {
    await humidityRepository.save({ humidity: Number(payload.humidity), timestamp: ts })
    saved = true
  }
  if (payload.type === "periodic_motion" && payload.states) {
    await motionRepository.save({
      zone1: Boolean(payload.states.zone_1),
      zone2: Boolean(payload.states.zone_2),
      zone3: Boolean(payload.states.zone_3),
      timestamp: ts
    })
    saved = true
  }

  if (topic.startsWith('smartoffice/') || topic.startsWith('node_b/') || topic.startsWith('office/')) {
    const zone = payload.zone !== undefined ? Number(payload.zone) : undefined
    const temp = payload.temp !== undefined ? Number(payload.temp) : undefined
    const status = payload.status ? String(payload.status) : undefined
    const type = payload.type ? String(payload.type) : 'unknown'

    await nodeBEventRepository.save({
      type, zone, temp, status, message: JSON.stringify(payload), timestamp: ts,
    })
    saved = true
  }

  if (!saved) {
    console.warn('[Redis] no matching repository for topic/payload', topic, payload)
  }
}

subClient.on('message', async (topic, message) => {
  const text = message.toString()
  try {
    const parsed = JSON.parse(text)
    
    // Evaluate rules only for real sensor data, not our own Redis replays
    if (!topic.startsWith('redis/')) {
      evaluateSmartRules(parsed);
    }
    
    if (topic.startsWith('smartoffice/status/')) {
      const nodeId = topic.split('/').pop()
      if (parsed.status) {
        nodeStatus[nodeId] = parsed.status;
      }
    }

    await saveToRedis(topic, parsed)
    const update = { topic, payload: parsed, timestamp: new Date().toISOString() }
    await redisClient.publish('sensor:updates', JSON.stringify(update))
  } catch (e) {
    console.warn('[MQTT SUB] non-json payload:', text)
  }
})

subClient.on('error', (err) => {
  console.error('[MQTT SUB] error', err)
})

pubClient.on('connect', () => {
  console.log('[MQTT PUB] connected to broker', brokerUrl)
})
pubClient.on('error', (err) => {
  console.error('[MQTT PUB] error', err)
})

export function publishSensorData(topic, payload) {
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload)
  pubClient.publish(topic, message, { qos: 0, retain: false }, (err) => {
    if (err) {
      console.error('[MQTT PUB] publish error', err)
    } else {
      console.log(`[MQTT PUB] published to ${topic}: ${message}`)
    }
  })
}

async function getLatestFromRepo(repository, fieldName) {
  const results = await repository.search().sortBy('timestamp', 'DESC').returnAll()
  if (!results || results.length === 0) return null
  const latest = results[0]
  if (fieldName) {
    return { value: latest[fieldName], timestamp: latest.timestamp }
  } else {
    return latest
  }
}

export async function publishFromRedis() {
  try {
    const temp = await getLatestFromRepo(temperatureRepository, 'temperature')
    const humidity = await getLatestFromRepo(humidityRepository, 'humidity')
    const latestMotion = await getLatestFromRepo(motionRepository)

    if (temp) {
      publishSensorData('redis/temperature', { type: 'temperature', temperature: Number(temp.value), ts: temp.timestamp })
    }
    if (humidity) {
      publishSensorData('redis/humidity', { type: 'humidity', humidity: Number(humidity.value), ts: humidity.timestamp })
    }
    if (latestMotion) {
      publishSensorData('redis/motion', { type: 'periodic_motion', states: { zone_1: latestMotion.zone1, zone_2: latestMotion.zone2, zone_3: latestMotion.zone3 }, ts: latestMotion.timestamp })
    }

    // Notice: The flawed 1-second interval command spam has been entirely deleted from here.

  } catch (error) {
    console.error('[MQTT PUB] error publishing from Redis', error)
  }
}

// Periodically evaluate state and push overrides to Actuator
setInterval(() => {
  reevaluateState()
}, 5000)
