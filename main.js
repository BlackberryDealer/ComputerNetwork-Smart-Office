import express from 'express'
import 'dotenv/config'
import { humidityRepository,
  temperatureRepository,
  motionRepository } from './config/redisRepository.js'

// Temporary test data
import { EntityId } from 'redis-om'

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile('index.html')
})

app.get("/get/:temperature", async (req, res) => {

  const searchTemperature = req.params.temperature
  
  const temperatureData = await temperatureRepository.search()
      .where('temperature').equals(searchTemperature).return.all()
  
  res.json(`Data received: ${temperatureData}\n`)
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

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000')
})
