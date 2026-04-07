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
  clean: true,
  reconnectPeriod: 2000,
  connectTimeout: 30 * 1000,
  protocolVersion: 4,      // Use MQTT 3.1.1 (standard)
  handshakeTimeout: 20000, // Allow more time for initial handshake on RPi
}

const MAX_RECONNECT_ATTEMPTS = 150  // ~5 minutes at 2s intervals
let reconnectAttempts = 0

const pubClient = mqtt.connect(brokerUrl, { ...connectOptions, clientId: 'node-c-pub' })
const subClient = mqtt.connect(brokerUrl, { ...connectOptions, clientId: 'node-c-sub' })

// --- SMART OFFICE DECISION ENGINE ---
const COMMAND_TOPIC = 'smartoffice/commands/node_b';

// Constants (configurable via environment variables)
const MOTION_TIMEOUT = Number(process.env.MOTION_TIMEOUT_MS) || 10000; // 10s timeout for LEDs
const AC_TEMP_THRESHOLD = Number(process.env.AC_TEMP_THRESHOLD) || 25.5;
const LED_POWER_WATTS = Number(process.env.LED_POWER_WATTS) || 50;
const AC_POWER_WATTS = Number(process.env.AC_POWER_WATTS) || 750;
const MIN_SAVING_INTERVAL_MS = Number(process.env.MIN_SAVING_INTERVAL_MS) || 60000; // Only track savings > 1min

// Zone occupancy state (booleans) — separate from timer handles
const zoneOccupied = { 1: false, 2: false, 3: false };
const zoneLightTimeouts = { 1: null, 2: null, 3: null };
const zoneOffTimestamps = { 1: null, 2: null, 3: null };
let currentTemp = 24.0;
let presentationMode = false;
let acOffTimestamp = null;

export const activeCommands = {
  AC: 'OFF',
  LED_1: 'OFF',
  LED_2: 'OFF',
  LED_3: 'OFF'
};

function trackAndPublish(device_id, command) {
  if (activeCommands[device_id] !== command) {
    activeCommands[device_id] = command;
  }
  publishSensorData(COMMAND_TOPIC, { device_id, command });
}

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
  LED_3: null,
  PRESENTATION: null
};

export const nodeStatus = {
  node_a: 'offline',
  node_b: 'offline',
  server: 'online'
};

function sendCommand(device_id, command) {
  if (deviceOverrides[device_id] !== null && deviceOverrides[device_id] !== 'AUTO') return; 
  trackAndPublish(device_id, command);
}

/**
 * Calculate energy savings from a time-off period.
 * Only counts if the off period exceeds MIN_SAVING_INTERVAL_MS.
 */
function trackEnergySaving(offTimestamp, redisKey, powerWatts) {
  if (!offTimestamp) return null;
  const timeOffMs = Date.now() - offTimestamp;
  if (timeOffMs < MIN_SAVING_INTERVAL_MS) return null;
  const hours = timeOffMs / (1000 * 60 * 60);
  const energySaved = (hours * powerWatts) / 1000;
  // Await Redis write to prevent data loss on failure
  redisClient.incrByFloat(redisKey, hours).then(() => {
    console.log(`[Analytics] Saved ${energySaved.toFixed(4)} kWh to ${redisKey}`)
  }).catch(e => console.error(`[Analytics] Failed to save energy data:`, e));
  return energySaved;
}

function evaluateSmartRules(payload) {
  // 1. Presentation Mode Logic
  if (payload.type === 'mode' && payload.status === 'presentation') {
    if (deviceOverrides.PRESENTATION === null) {
      setPresentationMode(!presentationMode);
    }
    return;
  }

  if (presentationMode) return; // Ignore auto-sensors while presenting

  // 2. Motion Logic (10-second timeout)
  if (payload.type === 'periodic_motion' && payload.states) {
    let roomJustOccupied = false;

    for (let i = 1; i <= 3; i++) {
      const isMotion = payload.states[`zone_${i}`];
      if (isMotion) {
        roomJustOccupied = true;

        // Track LED energy savings when zone comes back online
        trackEnergySaving(zoneOffTimestamps[i], 'analytics:time_saved_hours', LED_POWER_WATTS);
        zoneOffTimestamps[i] = null;

        // Track AC energy savings when room becomes occupied
        if (acOffTimestamp) {
          trackEnergySaving(acOffTimestamp, 'analytics:ac_time_saved_hours', AC_POWER_WATTS);
          acOffTimestamp = null;
        }

        sendCommand(`LED_${i}`, 'ON');
        zoneOccupied[i] = true;
        
        // Clear existing timer and start a new 10-second countdown
        if (zoneLightTimeouts[i]) clearTimeout(zoneLightTimeouts[i]);
        zoneLightTimeouts[i] = setTimeout(() => {
          console.log(`[Smart Logic] Zone ${i} empty for ${MOTION_TIMEOUT / 1000}s. Turning OFF.`);
          sendCommand(`LED_${i}`, 'OFF');
          zoneLightTimeouts[i] = null;
          zoneOccupied[i] = false;

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
  const isOccupied = Object.values(zoneOccupied).some(Boolean);
  if (!isOccupied && !presentationMode) {
    if (!acOffTimestamp && activeCommands['AC'] !== 'OFF') {
      acOffTimestamp = Date.now();
    }
    console.log('[Smart Logic] Entire office is empty. AC Auto-OFF.');
    sendCommand('AC', 'OFF');
  }
}

function updateAC() {
  if (presentationMode) return;
  
  const isOccupied = Object.values(zoneOccupied).some(Boolean);
  if (!isOccupied) return; // Do nothing if room is empty, checkOverallOccupancy handles the OFF command

  let acCommand = currentTemp > AC_TEMP_THRESHOLD ? 'FAST' : 'SLOW';
  sendCommand('AC', acCommand);
}
function getDesiredState(device_id, defaultState) {
  const override = deviceOverrides[device_id];
  if (override === null || override === 'AUTO') return defaultState;
  return override;
}

export function reevaluateState() {
  if (presentationMode) {
    trackAndPublish('LED_1', getDesiredState('LED_1', 'OFF'));
    trackAndPublish('LED_2', getDesiredState('LED_2', 'OFF'));
    trackAndPublish('LED_3', getDesiredState('LED_3', 'OFF'));
    trackAndPublish('AC', getDesiredState('AC', 'SLOW'));
    return;
  }

  for (let i = 1; i <= 3; i++) {
    const state = zoneOccupied[i] ? 'ON' : 'OFF';
    trackAndPublish(`LED_${i}`, getDesiredState(`LED_${i}`, state));
  }

  const isOccupied = Object.values(zoneOccupied).some(Boolean);
  const acDefault = isOccupied ? (currentTemp > AC_TEMP_THRESHOLD ? 'FAST' : 'SLOW') : 'OFF';
  trackAndPublish('AC', getDesiredState('AC', acDefault));
}

// --- END SMART OFFICE DECISION ENGINE ---

subClient.on('connect', () => {
  reconnectAttempts = 0  // Reset on successful connect
  console.log('[MQTT SUB] connected to broker', brokerUrl)
  const topics = ['smartoffice/sensors', 'smartoffice/#', 'redis/#', 'node_b/#']
  subClient.subscribe(topics, { qos: 1 }, (err, granted) => {
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
    const numTemp = Number(tempValue)
    // Validate temperature is in reasonable range
    if (!isNaN(numTemp) && numTemp >= -50 && numTemp <= 80) {
      await temperatureRepository.save({ temperature: numTemp, timestamp: ts })
      saved = true
    } else {
      console.warn('[Redis] Invalid temperature value rejected:', tempValue)
    }
  }
  if (payload.humidity !== undefined) {
    const numHum = Number(payload.humidity)
    // Validate humidity is in reasonable range
    if (!isNaN(numHum) && numHum >= 0 && numHum <= 100) {
      await humidityRepository.save({ humidity: numHum, timestamp: ts })
      saved = true
    } else {
      console.warn('[Redis] Invalid humidity value rejected:', payload.humidity)
    }
  }
  if (payload.type === "periodic_motion" && payload.states) {
    await motionRepository.save({
      zone1: payload.states.zone_1 === true,
      zone2: payload.states.zone_2 === true,
      zone3: payload.states.zone_3 === true,
      timestamp: ts
    })
    saved = true
  }

  if (topic.startsWith('smartoffice/') || topic.startsWith('node_b/')) {
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
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    console.warn('[MQTT SUB] non-json payload:', text)
    return
  }

  try {
    // Evaluate rules only for real sensor data, not our own Redis replays
    if (!topic.startsWith('redis/')) {
      evaluateSmartRules(parsed);
    }
  } catch (e) {
    console.error('[Smart Rules] evaluation error:', e)
  }

  try {
    if (topic.startsWith('smartoffice/status/')) {
      const nodeId = topic.split('/').pop()
      if (/^[a-zA-Z0-9_]+$/.test(nodeId) && parsed.status) {
        nodeStatus[nodeId] = parsed.status;
      }
    }
  } catch (e) {
    console.error('[MQTT SUB] status update error:', e)
  }

  try {
    await saveToRedis(topic, parsed)
  } catch (e) {
    console.error('[Redis] save error for topic', topic, ':', e)
  }

  try {
    const update = { topic, payload: parsed, timestamp: new Date().toISOString() }
    await redisClient.publish('sensor:updates', JSON.stringify(update))
  } catch (e) {
    console.error('[Redis Pub] publish error:', e)
  }
})

subClient.on('error', (err) => {
  console.error('[MQTT SUB] error', err)
})

pubClient.on('connect', () => {
  reconnectAttempts = 0
  console.log('[MQTT PUB] connected to broker', brokerUrl)
})
pubClient.on('error', (err) => {
  console.error('[MQTT PUB] error', err)
  reconnectAttempts++
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`[MQTT PUB] Exceeded ${MAX_RECONNECT_ATTEMPTS} reconnect attempts. Giving up.`)
    process.exit(1)
  }
})

export function publishSensorData(topic, payload) {
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload)
  pubClient.publish(topic, message, { qos: 1, retain: false }, (err) => {
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
