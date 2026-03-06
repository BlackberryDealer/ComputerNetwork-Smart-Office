import express from 'express'

import 'dotenv/config'
import './redis.js'

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.get('/', (req, res) => {
  res.send('Hello World\n')
})

app.get("/get/:testId", (req, res) => {

  const searchKey = req.params.testId

  res.send(`Data received: ${searchKey}\n`)
})

app.post('/post', (req, res) => {
  res.send('Data received\n')
})

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000')
})
