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

// Use default reconnect to allow broker startup race
const connectOptions = {
  clientId: `node-client-${Math.random().toString(16).slice(2)}`,
  clean: true,
  reconnectPeriod: 2000,
  connectTimeout: 30 * 1000,
}

// Separate publisher and subscriber clients (same broker)
const pubClient = mqtt.connect(brokerUrl, { ...connectOptions, clientId: `node-pub-${Math.random().toString(16).slice(2)}` })
const subClient = mqtt.connect(brokerUrl, { ...connectOptions, clientId: `node-sub-${Math.random().toString(16).slice(2)}` })

subClient.on('connect', () => {
  console.log('[MQTT SUB] connected to broker', brokerUrl)

  // Subscribe to Node B topics and smartoffice namespace
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

  // Save standard sensor values
  if (payload.temperature !== undefined || payload.temp !== undefined) {
    const tempValue = payload.temperature !== undefined ? payload.temperature : payload.temp
    await temperatureRepository.save({ temperature: Number(tempValue), timestamp: ts })
    console.log('[Redis] temperature saved', tempValue)
    saved = true
  }
  if (payload.humidity !== undefined) {
    await humidityRepository.save({ humidity: Number(payload.humidity), timestamp: ts })
    console.log('[Redis] humidity saved', payload.humidity)
    saved = true
  }
  if (payload.type === "periodic_motion" && payload.states) {
    await motionRepository.save({
      zone1: Boolean(payload.states.zone_1),
      zone2: Boolean(payload.states.zone_2),
      zone3: Boolean(payload.states.zone_3),
      timestamp: ts
    })
    console.log('[Redis] motion saved', payload.states)
    saved = true
  }

  // Save Node B event payloads for any smartoffice/sensors messages
  if (topic.startsWith('smartoffice/') || topic.startsWith('node_b/')) {
    const zone = payload.zone !== undefined ? Number(payload.zone) : undefined
    const temp = payload.temp !== undefined ? Number(payload.temp) : undefined
    const status = payload.status ? String(payload.status) : undefined
    const type = payload.type ? String(payload.type) : 'unknown'

    await nodeBEventRepository.save({
      type,
      zone,
      temp,
      status,
      message: JSON.stringify(payload),
      timestamp: ts,
    })
    console.log('[Redis] nodeBEvent saved', { type, zone, temp, status })
    saved = true
  }

  if (!saved) {
    console.warn('[Redis] no matching repository for topic/payload', topic, payload)
  }
}

subClient.on('message', async (topic, message) => {
  const text = message.toString()
  console.log(`[MQTT SUB] message: ${topic} -> ${text}`)
  try {
    const parsed = JSON.parse(text)
    console.log('[MQTT SUB] parsed payload', parsed)
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
  // Get newest entry by timestamp
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

    if (!temp && !humidity && !latestMotion) {
      console.log('[MQTT PUB] no Redis data yet to publish')
    }
  } catch (error) {
    console.error('[MQTT PUB] error publishing from Redis', error)
  }
}

// Periodically publish latest Redis data to devices on network
setInterval(() => {
  publishFromRedis().catch((err) => {
    console.error('[MQTT PUB] periodic publish error', err)
  })
}, 1000)

// Optional test periodic publishing
// setInterval(() => {
//   publishSensorData('office/temperature', {
//     sensor: 'temperature',
//     value: Number((20 + Math.random() * 10).toFixed(1)),
//     ts: new Date().toISOString(),
//   })
// }, 10000)

