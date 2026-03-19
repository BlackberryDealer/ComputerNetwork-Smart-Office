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
import { publishSensorData, deviceOverrides, nodeStatus, reevaluateState } from './mqtt.js'
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
  if (fs.existsSync('dist/index.html')) {
    res.sendFile('index.html', { root: 'dist' })
  } else {
    res.sendFile('index.html', { root: 'public' })
  }
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
    // EnergySaved = (TimeSavedInHours * 50W) / 1000
    const energySavedKWh = (parseFloat(timeSavedHours) * 50) / 1000;
    
    res.json({
      automated_corrections: parseInt(ghostEvents, 10),
      estimated_savings_kwh: energySavedKWh.toFixed(4)
    });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/chart-data', async (req, res) => {
  try {
    const since = new Date();
    since.setHours(since.getHours() - 1); // latest hour data

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

    res.json({
      temperature: temps.map(t => ({ timestamp: t.timestamp, temp: t.temperature })),
      acEvents: mappedAcEvents
    });
  } catch (err) {
    console.error('Error fetching chart data:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/overrides', (req, res) => {
  res.json(deviceOverrides);
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
  } else {
    deviceOverrides[device_id] = command;
    publishSensorData('office/commands/node_b', { device_id, command });
    res.json({ success: true, mode: 'MANUAL', device_id, command });
  }
});

app.get("/get/:temperature", async (req, res) => {

  const searchTemperature = req.params.temperature

  const temperatureData = await temperatureRepository.search()
    .where('temperature').equals(searchTemperature).return.all()

  console.log(`Search for temperature ${searchTemperature} returned:`, temperatureData)

  res.json(`Data received: ${temperatureData[0].temperature}\n`)
})

app.post('/post/:temperature', async (req, res) => {

  const temperature = parseFloat(req.params.temperature)

  let temperatureData = {
    temperature,
    timestamp: new Date().toISOString()
  }

  temperatureData = await temperatureRepository.save(temperatureData)

  res.send(`Data received. Temperature Entity: ${temperatureData[EntityId]}\n`)
})

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
