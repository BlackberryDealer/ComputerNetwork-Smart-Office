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
}

const pubClient = mqtt.connect(brokerUrl, { ...connectOptions, clientId: `node-pub-${Math.random().toString(16).slice(2)}` })
const subClient = mqtt.connect(brokerUrl, { ...connectOptions, clientId: `node-sub-${Math.random().toString(16).slice(2)}` })

// --- SMART OFFICE DECISION ENGINE ---
const COMMAND_TOPIC = 'office/commands/node_b';
const activeZones = { 1: null, 2: null, 3: null };
const MOTION_TIMEOUT = 7000; // 7 seconds timeout
let currentTemp = 24.0;
let presentationMode = false;

function evaluateSmartRules(payload) {
  // 1. Presentation Mode Check
  if (payload.type === 'mode' && payload.status === 'presentation') {
    presentationMode = !presentationMode;
    if (presentationMode) {
      console.log('[Smart Logic] Presentation Mode ON. Dimming office.');
      publishSensorData(COMMAND_TOPIC, { device_id: 'LED_1', command: 'OFF' });
      publishSensorData(COMMAND_TOPIC, { device_id: 'LED_2', command: 'OFF' });
      publishSensorData(COMMAND_TOPIC, { device_id: 'LED_3', command: 'OFF' });
      publishSensorData(COMMAND_TOPIC, { device_id: 'AC', command: 'SLOW' });
    } else {
      console.log('[Smart Logic] Presentation Mode OFF. Resuming auto-sensors.');
    }
    return;
  }

  if (presentationMode) return; // Ignore auto-sensors while presenting

  // 2. Motion Detected Logic
  if (payload.type === 'periodic_motion' && payload.states) {
    let roomJustOccupied = false;

    // Iterate through zones 1, 2, and 3
    for (let i = 1; i <= 3; i++) {
      const isMotion = payload.states[`zone_${i}`];
      if (isMotion) {
        roomJustOccupied = true;
        publishSensorData(COMMAND_TOPIC, { device_id: `LED_${i}`, command: 'ON' });
        
        // Clear existing timer and start a new 7-second countdown
        if (activeZones[i]) clearTimeout(activeZones[i]);
        activeZones[i] = setTimeout(() => {
          console.log(`[Smart Logic] Zone ${i} empty for 7s. Turning OFF.`);
          publishSensorData(COMMAND_TOPIC, { device_id: `LED_${i}`, command: 'OFF' });
          activeZones[i] = null; 
          checkOverallOccupancy();
        }, MOTION_TIMEOUT);
      }
    }
    if (roomJustOccupied) updateAC();
  }

  // 3. Climate Update Logic
  if (payload.type === 'climate' && payload.temp !== undefined) {
    currentTemp = payload.temp;
    updateAC();
  }
}

function checkOverallOccupancy() {
  const isOccupied = Object.values(activeZones).some(timer => timer !== null);
  if (!isOccupied && !presentationMode) {
    console.log('[Smart Logic] Entire office is empty. AC Auto-OFF.');
    publishSensorData(COMMAND_TOPIC, { device_id: 'AC', command: 'OFF' });
  }
}

function updateAC() {
  if (presentationMode) return;
  const isOccupied = Object.values(activeZones).some(timer => timer !== null);
  if (!isOccupied) return;

  let acCommand = 'OFF';
  if (currentTemp >= 28.0) acCommand = 'FAST';
  else if (currentTemp >= 24.0) acCommand = 'SLOW';

  publishSensorData(COMMAND_TOPIC, { device_id: 'AC', command: acCommand });
}
// --- END SMART OFFICE DECISION ENGINE ---

subClient.on('connect', () => {
  console.log('[MQTT SUB] connected to broker', brokerUrl)
  const topics = ['smartoffice/sensors', 'smartoffice/#', 'redis/#', 'node_b/#']
  subClient.subscribe(topics, { qos: 0 }, (err, granted) => {
    if (err) {
      console.error('[MQTT SUB] subscribe error', err)
      return
    }
    console.log('[MQTT SUB] subscribed to', granted.map((g) => g.topic).join(', '))
  })
})

async function saveToRedis(topic, payload) {
  const now = new Date()
  const ts = payload.ts ? new Date(payload.ts) : now
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
  try {
    const parsed = JSON.parse(text)
    
    // Evaluate the Smart Logic immediately when a message arrives
    evaluateSmartRules(parsed);

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
      publishSensorData('office/commands/node_b', { type: 'temperature', temperature: Number(temp.value), ts: temp.timestamp })
      publishSensorData('sensor:updates', { type: 'temperature', temperature: Number(temp.value), ts: temp.timestamp })
    }
    if (humidity) {
      publishSensorData('office/commands/node_b', { type: 'humidity', humidity: Number(humidity.value), ts: humidity.timestamp })
      publishSensorData('sensor:updates', { type: 'humidity', humidity: Number(humidity.value), ts: humidity.timestamp })

    }
    if (latestMotion) {
      publishSensorData('office/commands/node_b', { type: 'periodic_motion', states: { zone_1: latestMotion.zone1, zone_2: latestMotion.zone2, zone_3: latestMotion.zone3 }, ts: latestMotion.timestamp })
      publishSensorData('sensor:updates', { type: 'periodic_motion', states: { zone_1: latestMotion.zone1, zone_2: latestMotion.zone2, zone_3: latestMotion.zone3 }, ts: latestMotion.timestamp })
    }

    // Notice: Command publishing has been removed from here and moved to evaluateSmartRules()

  } catch (error) {
    console.error('[MQTT PUB] error publishing from Redis', error)
  }
}

setInterval(() => {
  publishFromRedis().catch((err) => {
    console.error('[MQTT PUB] periodic publish error', err)
  })
}, 1000)
