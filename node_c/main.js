import express from 'express'
import 'dotenv/config'
import { createServer } from 'http'
import { Aedes } from 'aedes'
import net from 'net'
import cors from 'cors'
import helmet from 'helmet'
import {
  humidityRepository,
  temperatureRepository,
  motionRepository,
} from './config/redisRepository.js'
import redisClient from './config/redis.js'
import {
  publishSensorData,
  deviceOverrides,
  nodeStatus,
  reevaluateState,
  getPresentationMode,
  setPresentationMode,
  activeCommands
} from './mqtt.js'
import { Server as SocketIOServer } from 'socket.io'
// Initialize the MQTT client + smart decision engine (side-effect import)
import './mqtt.js'

const app = express()

// --- SECURITY MIDDLEWARE ---
app.use(helmet({ contentSecurityPolicy: false })) // CSP disabled for Vite dev server
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map(s => s.trim())
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}))
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: false }))

// --- INPUT VALIDATION CONSTANTS ---
const ALLOWED_DEVICES = ['AC', 'LED_1', 'LED_2', 'LED_3', 'PRESENTATION']
const ALLOWED_COMMANDS = {
  AC: ['AUTO', 'OFF', 'SLOW', 'FAST', null],
  LED_1: ['AUTO', 'OFF', 'ON', null],
  LED_2: ['AUTO', 'OFF', 'ON', null],
  LED_3: ['AUTO', 'OFF', 'ON', null],
  PRESENTATION: ['AUTO', 'OFF', 'ON', null]
}
const TOPIC_REGEX = /^[a-zA-Z0-9/_-]+$/
const MAX_CHART_MINUTES = 120

// MQTT Broker
const broker = await Aedes.createBroker()
const mqttPort = 1883
const mqttServer = net.createServer(broker.handle)

mqttServer.listen(mqttPort, () => {
  console.log(`MQTT broker is running on port ${mqttPort}`)
})

broker.on('client', (client) => {
  console.log(`Client connected: ${client.id}`)
})

broker.on("publish", (packet, client) => {
  if (client) {
    console.log(`Message from ${client.id}: ${packet.payload.toString()}`);
  }
});

const httpServer = createServer(app)
const io = new SocketIOServer(httpServer)

app.use(express.static('dist'))

app.get('/', (req, res) => {
  res.sendFile('index.html', {
    root: 'dist' 
  })
})

// Helper functions to get latest data from Redis (optimized to fetch only 1 record)
async function getLatestTemp() {
  try {
    const results = await temperatureRepository.search().sortBy('timestamp', 'DESC').return.count(1)
    return results && results.length > 0 ? { temperature: results[0].temperature, timestamp: results[0].timestamp } : null
  } catch (err) {
    console.error('Error fetching latest temp:', err)
    return null
  }
}

async function getLatestHumidity() {
  try {
    const results = await humidityRepository.search().sortBy('timestamp', 'DESC').return.count(1)
    return results && results.length > 0 ? { humidity: results[0].humidity, timestamp: results[0].timestamp } : null
  } catch (err) {
    console.error('Error fetching latest humidity:', err)
    return null
  }
}

async function getLatestMotion() {
  try {
    const results = await motionRepository.search().sortBy('timestamp', 'DESC').return.count(1)
    return results && results.length > 0 ? { zone1: results[0].zone1, zone2: results[0].zone2, zone3: results[0].zone3, timestamp: results[0].timestamp } : null
  } catch (err) {
    console.error('Error fetching latest motion:', err)
    return null
  }
}

io.on('connection', async (socket) => {
  console.log('Socket client connected', socket.id)

  try {
    // Send initial data from Redis (parallel queries for performance)
    const [temp, hum, motion] = await Promise.all([
      getLatestTemp(),
      getLatestHumidity(),
      getLatestMotion()
    ])

    if (temp) {
      socket.emit('sensor-update', { topic: 'initial/temp', payload: { temperature: temp.temperature }, timestamp: temp.timestamp })
    }
    if (hum) {
      socket.emit('sensor-update', { topic: 'initial/humidity', payload: { humidity: hum.humidity }, timestamp: hum.timestamp })
    }
    if (motion) {
      socket.emit('sensor-update', { topic: 'initial/motion', payload: { type: 'periodic_motion', states: { zone_1: motion.zone1, zone_2: motion.zone2, zone_3: motion.zone3 } }, timestamp: motion.timestamp })
    }
  } catch (err) {
    console.error('Error sending initial data to socket', socket.id, err)
    socket.emit('error', { message: 'Failed to load initial data' })
  }

  socket.on('disconnect', () => {
    console.log('Socket client disconnected', socket.id)
  })

  socket.on('error', (err) => {
    console.error('Socket error for', socket.id, err)
    socket.disconnect(true)
  })
})

// Redis pub/sub stream to socket.io
let subscriber;
try {
  subscriber = redisClient.duplicate()
  await subscriber.connect()
  await subscriber.subscribe('sensor:updates', (msg) => {
    try {
      const payload = JSON.parse(msg)
      io.emit('sensor-update', payload)
    } catch (e) {
      console.warn('Invalid Redis stream message', msg)
    }
  })
} catch (err) {
  console.error('Failed to setup Redis subscriber:', err)
}

app.get('/api/analytics', async (req, res) => {
  try {
    const ghostEvents = await redisClient.get('analytics:ghost_events') || 0;
    const timeSavedHours = await redisClient.get('analytics:time_saved_hours') || 0;
    const acTimeSavedHours = await redisClient.get('analytics:ac_time_saved_hours') || 0;
    
    const energySavedKWh = (parseFloat(timeSavedHours) * 50) / 1000;
    const acEnergySavedKWh = (parseFloat(acTimeSavedHours) * 750) / 1000;
    
    res.json({
      automated_corrections: parseInt(ghostEvents, 10),
      estimated_savings_kwh: energySavedKWh.toFixed(4),
      estimated_ac_savings_kwh: acEnergySavedKWh.toFixed(4)
    });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

const MAX_CHART_RECORDS = 10000

app.get('/api/chart-data', async (req, res) => {
  try {
    const rawMinutes = req.query.minutes;
    if (rawMinutes !== undefined && !/^\d+$/.test(rawMinutes)) {
      return res.status(400).json({ error: 'minutes must be a positive integer' });
    }
    const parsedMinutes = parseInt(rawMinutes);
    const minutes = Math.min(Math.max(Number.isNaN(parsedMinutes) ? 10 : parsedMinutes, 1), MAX_CHART_MINUTES);
    const since = new Date();
    since.setMinutes(since.getMinutes() - minutes);

    const temps = await temperatureRepository.search()
      .where('timestamp').gte(since)
      .return.page(0, MAX_CHART_RECORDS);
    
    const { nodeBEventRepository } = await import('./config/redisRepository.js');
    const commands = await nodeBEventRepository.search()
      .where('timestamp').gte(since)
      .return.page(0, MAX_CHART_RECORDS);
      
    const acEvents = commands.filter(cmd => {
      try {
        const parsed = JSON.parse(cmd.message || '{}');
        return parsed.device_id === 'AC';
      } catch {
        return false;
      }
    }).map(evt => {
      let status = 0;
      try {
        const parsed = JSON.parse(evt.message);
        if (parsed.command === 'SLOW') status = 1;
        if (parsed.command === 'FAST') status = 2;
      } catch {}
      return { timestamp: evt.timestamp, status };
    });

    const motions = await motionRepository.search()
      .where('timestamp').gte(since)
      .return.page(0, MAX_CHART_RECORDS);

    res.json({
      temperature: temps.map(t => ({ timestamp: t.timestamp, temp: t.temperature })),
      acEvents: acEvents,
      motionEvents: motions.map(m => ({ 
        timestamp: m.timestamp, 
        zone1: m.zone1 ? 1 : 0, 
        zone2: m.zone2 ? 1 : 0, 
        zone3: m.zone3 ? 1 : 0 
      }))
    });
  } catch (err) {
    console.error('Error fetching chart data:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/active-commands', (req, res) => {
  res.json({ ...activeCommands, PRESENTATION: getPresentationMode() ? 'ON' : 'OFF' });
});

app.get('/api/overrides', (req, res) => {
  res.json(deviceOverrides);
});

app.get('/api/presentation', (req, res) => {
  res.json({ presentationMode: getPresentationMode() });
});

app.post('/api/presentation', (req, res) => {
  const { mode } = req.body;
  if (typeof mode !== 'boolean') return res.status(400).json({ error: 'mode must be boolean' });
  setPresentationMode(mode);
  reevaluateState();
  res.json({ success: true, presentationMode: getPresentationMode() });
});

app.get('/api/nodes', (req, res) => {
  const result = {}
  for (const [nodeId, status] of Object.entries(nodeStatus)) {
    result[nodeId] = {
      status,
      lastSeen: status === 'online' ? new Date().toISOString() : null
    }
  }
  res.json(result);
});

app.post('/api/overrides', (req, res) => {
  const { device_id, command } = req.body;
  if (!device_id || typeof device_id !== 'string') return res.status(400).json({ error: 'device_id required (string)' });
  
  if (!ALLOWED_DEVICES.includes(device_id)) {
    return res.status(400).json({ error: `Invalid device_id. Allowed: ${ALLOWED_DEVICES.join(', ')}` });
  }

  // Explicitly validate command type — prevent null bypass
  if (command !== undefined && command !== null && typeof command !== 'string') {
    return res.status(400).json({ error: 'command must be a string, null, or undefined' });
  }

  if (command !== null && command !== 'AUTO' && !ALLOWED_COMMANDS[device_id]?.includes(command)) {
    return res.status(400).json({ error: `Invalid command '${command}' for ${device_id}` });
  }

  if (command === 'AUTO' || command === null) {
    deviceOverrides[device_id] = null;
    reevaluateState();
    res.json({ success: true, mode: 'AUTO', device_id });
  } else if (device_id === 'PRESENTATION') {
    deviceOverrides.PRESENTATION = command;
    setPresentationMode(command === 'ON');
    reevaluateState();
    res.json({ success: true, mode: 'MANUAL', device_id, command });
  } else {
    deviceOverrides[device_id] = command;
    publishSensorData('smartoffice/commands/node_b', { device_id, command });
    res.json({ success: true, mode: 'MANUAL', device_id, command });
  }
});

const publishRateLimiter = (() => {
  const hits = new Map()
  const WINDOW_MS = 60_000
  const MAX_HITS = 60
  return (req, res, next) => {
    const key = req.ip || 'unknown'
    const now = Date.now()
    const record = hits.get(key) || { count: 0, start: now }
    if (now - record.start > WINDOW_MS) { record.count = 0; record.start = now }
    record.count++
    hits.set(key, record)
    if (record.count > MAX_HITS) {
      return res.status(429).json({ error: 'Rate limit exceeded. Max 60 requests/minute.' })
    }
    next()
  }
})()

app.post('/mqtt/publish/:topic', publishRateLimiter, (req, res) => {
  const topic = req.params.topic

  if (!TOPIC_REGEX.test(topic)) {
    return res.status(400).json({ error: 'Invalid topic format. Only alphanumeric, /, -, _ allowed.' });
  }

  const payload = req.body || { value: req.query.value || 'test' }

  // Validate payload: must be a plain object with reasonable size
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return res.status(400).json({ error: 'Payload must be a JSON object.' });
  }
  const payloadStr = JSON.stringify(payload)
  if (payloadStr.length > 2048) {
    return res.status(413).json({ error: 'Payload too large. Maximum 2KB.' });
  }

  publishSensorData(topic, payload)
  res.json({ status: 'published', topic, payload })
})

// Health check endpoint for monitoring
app.get('/health', async (req, res) => {
  const health = { status: 'healthy', mqtt: false, redis: false, uptime: process.uptime() };

  try {
    await redisClient.ping();
    health.redis = true;
  } catch {
    health.status = 'unhealthy';
  }

  // Check MQTT broker by verifying the Aedes broker has connected clients
  try {
    const connectedClients = broker.clients.size
    health.mqtt = true
    health.mqtt_clients = connectedClients
  } catch {
    health.status = 'unhealthy'
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

const port = process.env.PORT || 3000
httpServer.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})

// --- GRACEFUL SHUTDOWN ---
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received - shutting down gracefully...`);

  // Force exit after 10s if cleanup hangs
  const forceTimer = setTimeout(() => {
    console.error('Shutdown timeout exceeded — force exiting');
    process.exit(1)
  }, 10_000)

  try {
    await new Promise((resolve) => httpServer.close(resolve))
    console.log('HTTP server closed')
    await new Promise((resolve) => mqttServer.close(resolve))
    console.log('MQTT server closed')

    if (subscriber) {
      await subscriber.unsubscribe('sensor:updates');
      await subscriber.disconnect();
    }
    await redisClient.quit();
    console.log('Redis connections closed');

    clearTimeout(forceTimer)
    process.exit(0);
  } catch (e) {
    console.error('Error during shutdown:', e);
    clearTimeout(forceTimer)
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
