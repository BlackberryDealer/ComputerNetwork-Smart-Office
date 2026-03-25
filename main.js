import express from 'express'
import 'dotenv/config'
import { createServer } from 'http'
import { Aedes } from 'aedes'
import net from 'net'
import {
  humidityRepository,
  temperatureRepository,
  motionRepository,
} from './config/redisRepository.js'
import redisClient from './config/redis.js'
import { publishSensorData, deviceOverrides, nodeStatus, reevaluateState, getPresentationMode, setPresentationMode, activeCommands } from './mqtt.js'
import { EntityId } from 'redis-om'
import { Server as SocketIOServer } from 'socket.io'
import './mqtt.js' // Ensure MQTT client is initialized and connected

const app = express()

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

app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.use(express.static('dist'))
app.use(express.static('public'))

import fs from 'fs'
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


app.get('/api/motion-history', async (req, res) => {
  try {
    const { range } = req.query;
    let since = new Date();
    if (range === 'hour') {
      since.setHours(since.getHours() - 1);
    } else if (range === 'day') {
      since.setDate(since.getDate() - 1);
    } else if (range === 'week') {
      since.setDate(since.getDate() - 7);
    } else {
      since.setMinutes(since.getMinutes() - 1); // default 1 min
    }

    const results = await motionRepository.search()
      .where('timestamp').gte(since)
      .return.page(0, 100000);

    let z1 = 0, z2 = 0, z3 = 0;

    for (let row of results) {
      if (row.zone1) z1++;
      if (row.zone2) z2++;
      if (row.zone3) z3++;
    }

    res.json({
      total: results.length,
      zone_1: z1,
      zone_2: z2,
      zone_3: z3
    });
  } catch (err) {
    console.error('Error fetching motion history:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

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
    const minutes = parseInt(req.query.minutes) || 10;
    const since = new Date();
    since.setMinutes(since.getMinutes() - minutes);

    // Fetch temp history
    const temps = await temperatureRepository.search()
      .where('timestamp').gte(since)
      .return.all();
    
    // Fetch AC events
    // nodeBEventRepository tracks device commands
    const { nodeBEventRepository } = await import('./config/redisRepository.js');
    const commands = await nodeBEventRepository.search()
      .where('timestamp').gte(since)
      .return.all();
      
    const acEvents = commands.filter(cmd => cmd.message && cmd.message.includes('"device_id":"AC"'));
    const mappedAcEvents = acEvents.map(evt => {
      let status = 0;
      if (evt.message.includes('"command":"SLOW"')) status = 1;
      if (evt.message.includes('"command":"FAST"')) status = 2;
      return { timestamp: evt.timestamp, status };
    });

    // Fetch motion events
    const motions = await motionRepository.search()
      .where('timestamp').gte(since)
      .return.all();

    res.json({
      temperature: temps.map(t => ({ timestamp: t.timestamp, temp: t.temperature })),
      acEvents: mappedAcEvents,
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
    publishSensorData('office/commands/node_b', { device_id, command });
    res.json({ success: true, mode: 'MANUAL', device_id, command });
  }
});

app.post('/mqtt/publish/:topic', (req, res) => {
  const topic = req.params.topic
  const payload = req.body || { value: req.query.value || 'test' }
  publishSensorData(topic, payload)
  res.json({ status: 'published', topic, payload })
})

const port = process.env.PORT || 3000
httpServer.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})
