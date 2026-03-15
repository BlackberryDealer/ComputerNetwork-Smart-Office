import mqtt from 'mqtt'
import EventEmitter from 'events'
import redisClient from './config/redis.js'
import {
  humidityRepository,
  temperatureRepository,
  motionRepository,
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

  // Accepts all office-related topics
  subClient.subscribe('smartoffice/#', { qos: 0 }, (err) => {
    if (err) {
      console.error('[MQTT SUB] subscribe error', err)
      return
    }
    console.log('[MQTT SUB] subscribed to smartoffice/#')
  })
})

async function saveToRedis(topic, payload) {
  const now = new Date()
  const ts = payload.ts ? new Date(payload.ts) : now

  // If payload carries all measurements in one message, save each
  let saved = false
  if (payload.temperature !== undefined) {
    await temperatureRepository.save({ temperature: Number(payload.temperature), timestamp: ts })
    console.log('[Redis] temperature saved', payload.temperature)
    saved = true
  }
  if (payload.humidity !== undefined) {
    await humidityRepository.save({ humidity: Number(payload.humidity), timestamp: ts })
    console.log('[Redis] humidity saved', payload.humidity)
    saved = true
  }
  if (payload.motion !== undefined) {
    await motionRepository.save({ motion: Boolean(payload.motion), timestamp: ts })
    console.log('[Redis] motion saved', payload.motion)
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
  return { value: results[0][fieldName], timestamp: results[0].timestamp }
}

export async function publishFromRedis() {
  try {
    const temp = await getLatestFromRepo(temperatureRepository, 'temperature')
    const humidity = await getLatestFromRepo(humidityRepository, 'humidity')
    const motion = await getLatestFromRepo(motionRepository, 'motion')

    if (temp) {
      publishSensorData('redis/temperature', { type: 'temperature', temperature: Number(temp.value), ts: temp.timestamp })
    }
    if (humidity) {
      publishSensorData('redis/humidity', { type: 'humidity', humidity: Number(humidity.value), ts: humidity.timestamp })
    }
    if (motion) {
      publishSensorData('redis/motion', { type: 'motion', motion: Boolean(motion.value), ts: motion.timestamp })
    }

    if (!temp && !humidity && !motion) {
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

