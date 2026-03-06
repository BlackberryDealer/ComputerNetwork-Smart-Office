import express from 'express'

import 'dotenv/config'
import './redis.js'

const app = express()
app.use(express.urlencoded({ extended: false }))

app.get('/', (req, res) => {
  res.send('Hello World\n')
})

app.get("/get/:testId", (req, res) => {
  res.send(`Data received: ${req.body.testId}\n`)
})

app.post('/post', (req, res) => {
  res.send('Data received\n')
})

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000')
})
