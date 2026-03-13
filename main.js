import express from 'express'
import 'dotenv/config'
import redisClient from './config/redis.js'

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile('index.html')
})

app.get("/get/:testId", async (req, res) => {

  const searchKey = req.params.testId
  
  const value = await redisClient.get(searchKey);
  console.log("Searched data", value)
  
  res.send(`Data received: ${searchKey}\n`)
})

app.post('/post/:testInput', async (req, res) => {

  const testInput = req.params.testInput
  console.log("Test Input", testInput)
  
  await redisClient.set("key", testInput);

  res.send('Data received\n')
})

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000')
})
