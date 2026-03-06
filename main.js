import express from 'express'

import 'dotenv/config'
// import './redis.js'
import { createClient } from "redis";


const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.get('/', (req, res) => {
  res.send('Hello World\n')
})

app.get("/get/:testId", async (req, res) => {

  const searchKey = req.params.testId
  
  const client = await createClient({ url: process.env.REDIS_URL })
    .on("error", (err) => console.log("Redis Client Error", err))
    .connect();
  
  // await client.set("key", "test value");
  const value = await client.get(searchKey);
  console.log(value)
  client.destroy();
  
  res.send(`Data received: ${searchKey}\n`)
})

app.post('/post', (req, res) => {
  res.send('Data received\n')
})

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000')
})
