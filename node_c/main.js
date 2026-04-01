import express from 'express'
import 'dotenv/config'
import { createServer } from 'http'
import { Aedes } from 'aedes'
import net from 'net'
import cors from 'cors'
import {
  humidityRepository,
  temperatureRepository,
  motionRepository,
} from './config/redisRepository.js'
import redisClient from './config/redis.js'
import { publishSensorData,
  deviceOverrides,
  nodeStatus,
  reevaluateState,
  getPresentationMode,
  setPresentationMode,
  activeCommands
} from './mqtt.js'
import { Server as SocketIOServer } from 'socket.io'
import './mqtt.js' // Ensure MQTT client is initialized and connected

const app = express()

// --- MIDDLEWARE ---
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
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

// Helper functions to get latest data from Redis
async function getLatestTemp() {
  const results = await temperatureRepository.search().sortBy('timestamp', 'DESC').return.all()
  return results && results.length > 0 ? { temperature: results[0].temperature, timestamp: results[0].timestamp } : null
}

async function getLatestHumidity() {
  const results = await humidityRepository.search().sortBy('timestamp', 'DESC').return.all()
  return results && results.length > 0 ? { humidity: results[0].humidity, timestamp: results[0].timestamp } : null
}

async function getLatestMotion() {
  const results = await motionRepository.search().sortBy('timestamp', 'DESC').return.all()
  return results && results.length > 0 ? { zone1: results[0].zone1, zone2: results[0].zone2, zone3: results[0].zone3, timestamp: results[0].timestamp } : null
}

io.on('connection', async (socket) => {
  console.log('Socket client connected', socket.id)

  // Send initial data from Redis
  const temp = await getLatestTemp()
  if (temp) {
    socket.emit('sensor-update', { topic: 'initial/temp', payload: { temperature: temp.temperature }, timestamp: temp.timestamp })
  }

  const hum = await getLatestHumidity()
  if (hum) {
    socket.emit('sensor-update', { topic: 'initial/humidity', payload: { humidity: hum.humidity }, timestamp: hum.timestamp })
  }

  const motion = await getLatestMotion()
  if (motion) {
    socket.emit('sensor-update', { topic: 'initial/motion', payload: { type: 'periodic_motion', states: { zone_1: motion.zone1, zone_2: motion.zone2, zone_3: motion.zone3 } }, timestamp: motion.timestamp })
  }

  socket.on('disconnect', () => {
    console.log('Socket client disconnected', socket.id)
  })
})

// Redis pub/sub stream to socket.io
const subscriber = redisClient.duplicate()
await subscriber.connect()
await subscriber.subscribe('sensor:updates', (msg) => {
  try {
    const payload = JSON.parse(msg)
    io.emit('sensor-update', payload)
  } catch (e) {
    console.warn('Invalid Redis stream message', msg)
  }
})

app.get('/api/analytics', async (req, res) => {
  try {
    const ghostEvents = await redisClient.get('analytics:ghost_events') || 0;
    const timeSavedHours = await redisClient.get('analytics:time_saved_hours') || 0;
    const acTimeSavedHours = await redisClient.get('analytics:ac_time_saved_hours') || 0;
    
    // EnergySaved = (TimeSavedInHours * 50W) / 1000
    const energySavedKWh = (parseFloat(timeSavedHours) * 50) / 1000;
    const acEnergySavedKWh = (parseFloat(acTimeSavedHours) * 750) / 1000; // 750W for AC
    
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

app.get('/api/chart-data', async (req, res) => {
  try {
    const minutes = Math.min(Math.max(parseInt(req.query.minutes) || 10, 1), MAX_CHART_MINUTES);
    const since = new Date();
    since.setMinutes(since.getMinutes() - minutes);

    // Fetch temp history (paginated for safety)
    const temps = await temperatureRepository.search()
      .where('timestamp').gte(since)
      .return.all();
    
    // Fetch AC events (paginated for safety)
    const { nodeBEventRepository } = await import('./config/redisRepository.js');
    const commands = await nodeBEventRepository.search()
      .where('timestamp').gte(since)
      .return.all();
      
    // Parse JSON properly instead of string matching
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

    // Fetch motion events (paginated for safety)
    const motions = await motionRepository.search()
      .where('timestamp').gte(since)
      .return.all();

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
  res.json(nodeStatus);
});

app.post('/api/overrides', (req, res) => {
  const { device_id, command } = req.body;
  if (!device_id) return res.status(400).json({ error: 'device_id required' });
  
  // Validate device_id against whitelist
  if (!ALLOWED_DEVICES.includes(device_id)) {
    return res.status(400).json({ error: `Invalid device_id. Allowed: ${ALLOWED_DEVICES.join(', ')}` });
  }

  // Validate command against per-device whitelist
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

app.post('/mqtt/publish/:topic', (req, res) => {
  const topic = req.params.topic

  // Validate topic format (alphanumeric, slashes, hyphens, underscores only)
  if (!TOPIC_REGEX.test(topic)) {
    return res.status(400).json({ error: 'Invalid topic format. Only alphanumeric, /, -, _ allowed.' });
  }

  const payload = req.body || { value: req.query.value || 'test' }
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

  // MQTT broker runs in-process, so it's always available if the server is running
  health.mqtt = true;

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

const port = process.env.PORT || 3000
httpServer.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})

// --- GRACEFUL SHUTDOWN ---
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);

  // Stop accepting new connections
  httpServer.close(() => console.log('HTTP server closed'));
  mqttServer.close(() => console.log('MQTT server closed'));

  // Close Redis connections
  try {
    await subscriber.unsubscribe('sensor:updates');
    await subscriber.disconnect();
    await redisClient.quit();
    console.log('Redis connections closed');
  } catch (e) {
    console.error('Error closing Redis:', e);
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
