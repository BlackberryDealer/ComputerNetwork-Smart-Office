import mqtt from 'mqtt'

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
  subClient.subscribe('office/#', { qos: 0 }, (err) => {
    if (err) {
      console.error('[MQTT SUB] subscribe error', err)
      return
    }
    console.log('[MQTT SUB] subscribed to office/#')
  })
})

subClient.on('message', (topic, message) => {
  const text = message.toString()
  console.log(`[MQTT SUB] message: ${topic} -> ${text}`)
  try {
    const parsed = JSON.parse(text)
    console.log('[MQTT SUB] parsed payload', parsed)
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

// Optional test periodic publishing
// setInterval(() => {
//   publishSensorData('office/temperature', {
//     sensor: 'temperature',
//     value: Number((20 + Math.random() * 10).toFixed(1)),
//     ts: new Date().toISOString(),
//   })
// }, 10000)

