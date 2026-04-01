# 🏢 Smart Office — IoT Networking Project

A distributed **Internet of Things (IoT)** smart-office system built across **3 Raspberry Pi nodes** and an **external PC dashboard client**, communicating over a local area network (LAN) using the **MQTT protocol**. The system autonomously manages lighting and climate control based on real-time sensor data, while providing a live React dashboard for monitoring, analytics, and manual overrides.

---

## 📋 Table of Contents

- [Architecture Overview](#-architecture-overview)
- [Network Topology](#-network-topology)
- [Node Breakdown](#-node-breakdown)
  - [Node A — Sensor Node (Raspberry Pi)](#node-a--sensor-node-raspberry-pi)
  - [Node B — Actuator Node (Raspberry Pi)](#node-b--actuator-node-raspberry-pi)
  - [Node C — Server & Dashboard (Raspberry Pi)](#node-c--server--dashboard-raspberry-pi)
  - [External PC — Dashboard Client](#external-pc--dashboard-client)
- [Smart Automation Logic](#-smart-automation-logic)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Hardware Requirements](#-hardware-requirements)
- [Software Requirements](#-software-requirements)
- [Installation & Setup](#-installation--setup)
  - [Node A Setup](#node-a-setup)
  - [Node B Setup](#node-b-setup)
  - [Node C Setup](#node-c-setup)
  - [External PC Setup](#external-pc-setup)
- [Configuration](#-configuration)
- [API Endpoints](#-api-endpoints)
- [MQTT Topics](#-mqtt-topics)
- [Features](#-features)
- [License](#-license)

---

## 🏗 Architecture Overview

The project follows a **star topology** centered on Node C, using the **publish-subscribe (pub/sub)** pattern via MQTT. **Node A and Node B are separate Raspberry Pis that communicate exclusively with Node C** — they never communicate with each other directly. Node A publishes sensor data to Node C's broker; Node C processes the data through a smart decision engine and publishes commands to Node B, which controls physical actuators (LEDs and a servo motor).

```
┌──────────────┐    MQTT Publish     ┌──────────────────────────┐   MQTT Subscribe   ┌──────────────┐
│              │  (sensor data)      │                          │  (commands)        │              │
│   NODE A     │ ──────────────────► │       NODE C             │ ──────────────────► │   NODE B     │
│  (Sensors)   │                     │  (Broker + Server +      │                     │  (Actuators) │
│              │ ◄────────────────── │   Decision Engine +      │ ◄────────────────── │              │
│  DHT11       │    MQTT LWT /       │   Dashboard)             │   MQTT LWT /        │  3× LEDs     │
│  3× PIR      │    Heartbeat        │                          │    Heartbeat        │  1× Servo    │
│  Touch Btn   │                     │  Express.js + Aedes      │                     │              │
└──────────────┘                     │  Socket.IO + Redis       │                     └──────────────┘
                                     │  React Dashboard         │
                                     └───────────┬──────────────┘
                                                 │
                                          HTTP / WebSocket
                                                 │
                                     ┌───────────▼──────────────┐
                                     │      EXTERNAL PC         │
                                     │   (Browser Dashboard)    │
                                     └──────────────────────────┘
```

---

## 🌐 Network Topology

All devices are connected to the same **LAN** (via Wi-Fi or Ethernet). The network uses a **star topology** with Node C at the center. **Node A and Node B are independent Raspberry Pis that only communicate with Node C** — there is no direct connection between them. Node C acts as the central hub, running the MQTT broker and web server.

| Device        | Role                  | IP Address            | Port(s)         |
|---------------|-----------------------|-----------------------|-----------------|
| Raspberry Pi A| Sensor Publisher      | DHCP-assigned         | N/A (client)    |
| Raspberry Pi B| Actuator Subscriber   | DHCP-assigned         | N/A (client)    |
| Raspberry Pi C| MQTT Broker + Server  | Static/Fixed IP       | 1883, 3000      |
| External PC   | Dashboard Client      | DHCP-assigned         | N/A (browser)   |

> **Note:** Nodes A and B must be configured with Node C's LAN IP address as the MQTT broker URL. They do not need to know each other's IP addresses — all communication flows through Node C.

---

## 🔧 Node Breakdown

### Node A — Sensor Node (Raspberry Pi — Standalone)

**File:** `node_a/python_sensor_node.py`

Node A is a **standalone Raspberry Pi** dedicated to data acquisition. It connects **only to Node C** over the LAN and has no direct communication with Node B. It reads physical environmental data and publishes it to the MQTT broker running on Node C.

#### Sensors
| Sensor         | GPIO Pin | Measurement          | Read Interval |
|----------------|----------|----------------------|---------------|
| DHT11          | GPIO 4   | Temperature & Humidity | Every 5s    |
| PIR Zone 1     | GPIO 18  | Motion (Zone 1)      | Every 2s        |
| PIR Zone 2     | GPIO 24  | Motion (Zone 2)      | Every 2s        |
| PIR Zone 3     | GPIO 22  | Motion (Zone 3)      | Every 2s        |
| Touch Button   | GPIO 17  | Presentation Mode    | Instant (event) |

#### Behavior
- **Periodic motion** readings are published every **2 seconds** with zone occupancy states.
- **Climate readings** (temperature + humidity) are published every **5 seconds** via the DHT11 sensor.
- **Presentation mode** is triggered instantly on button press and published as an event.
- Uses **MQTT Last Will and Testament (LWT)** to automatically publish an `offline` status if the node disconnects unexpectedly.
- Publishes an `online` retained message on startup.

#### Published MQTT Messages
```json
// Climate (every 5s)
{ "type": "climate", "temp": 24.5, "humidity": 55.0, "timestamp": "2026-04-01T10:00:00" }

// Motion (every 2s)
{ "type": "periodic_motion", "states": { "zone_1": true, "zone_2": false, "zone_3": true }, "timestamp": "2026-04-01T10:00:00" }

// Presentation Mode (instant)
{ "type": "mode", "status": "presentation", "timestamp": "2026-04-01T10:00:00" }
```

---

### Node B — Actuator Node (Raspberry Pi — Standalone)

**File:** `node_b/node_b_mqtt.py`

Node B is a **standalone Raspberry Pi** dedicated to actuator control. It connects **only to Node C** over the LAN and has no direct communication with Node A. It subscribes to command topics from Node C's broker and controls physical actuators accordingly.

#### Actuators
| Actuator       | GPIO Pin | Function                      |
|----------------|----------|-------------------------------|
| LED 1          | GPIO 23  | Zone 1 Lighting               |
| LED 2          | GPIO 24  | Zone 2 Lighting               |
| LED 3          | GPIO 25  | Zone 3 Lighting               |
| Servo Motor    | GPIO 12  | AC Vent Control (speed/position) |

#### Behavior
- Subscribes to `smartoffice/commands/node_b` and executes received commands.
- **LED Control:** Turns LEDs ON/OFF based on received commands.
- **AC Servo Control:** Sweeps the servo back and forth to simulate AC operation:
  - `OFF` — Servo stops.
  - `SLOW` — Servo sweeps slowly.
  - `FAST` — Servo sweeps quickly.
- **10-second timeout safety:** If no command is received for a device within 10 seconds, the device is automatically turned OFF (failsafe against network failures).
- Publishes a **heartbeat** every 2 seconds on `smartoffice/status/node_b` so the dashboard can track node health.
- Uses **LWT** for offline status notification on unexpected disconnection.
- Uses `pigpio` factory for precise servo PWM control.

---

### Node C — Server & Dashboard (Raspberry Pi)

**Directory:** `node_c/`

Node C is the **central brain** of the system. It hosts the MQTT broker, the web server, the smart decision engine, persistent data storage, and serves the React dashboard.

#### Components

| Component        | Technology         | Purpose                                    |
|------------------|--------------------|--------------------------------------------|
| MQTT Broker      | Aedes              | In-process broker for all MQTT traffic     |
| Web Server       | Express.js (v5)    | REST API + static file serving             |
| Real-time Push   | Socket.IO          | Live sensor updates to dashboard           |
| Database         | Redis + RedisOM    | Time-series storage for sensors & events   |
| Decision Engine  | Custom (mqtt.js)   | Smart automation logic                     |
| Frontend         | React + Vite       | Dashboard UI with charts & controls        |
| Charts           | Chart.js           | Temperature, AC, and motion visualization  |

#### Smart Decision Engine (`mqtt.js`)

The decision engine subscribes to all sensor topics and autonomously publishes commands to Node B:

1. **Motion-based Lighting:**
   - When motion is detected in a zone → LED for that zone turns **ON**.
   - If no motion is detected for **10 seconds** → LED turns **OFF** (ghost occupancy event logged).

2. **Temperature-based AC Control:**
   - Room occupied + temperature **≤ 25.5°C** → AC set to **SLOW**.
   - Room occupied + temperature **> 25.5°C** → AC set to **FAST**.
   - Room unoccupied → AC turns **OFF**.

3. **Presentation Mode:**
   - Triggered by the physical touch button on Node A.
   - All LEDs turn **OFF**, AC set to **SLOW**.
   - Toggles on/off with each button press.

4. **Manual Overrides:**
   - Dashboard users can override any device to ON/OFF manually.
   - Setting a device to `AUTO` returns it to smart engine control.

5. **Energy Analytics:**
   - Tracks **ghost occupancy events** (false motion triggers that were auto-corrected).
   - Calculates **LED energy saved** (kWh) during unoccupied periods (based on 50W per LED).
   - Calculates **AC energy saved** (kWh) during unoccupied periods (based on 750W for AC).

---

### External PC — Dashboard Client

Any device on the LAN can access the dashboard by navigating to `http://<NODE_C_IP>:3000` in a web browser.

---

## 🧠 Smart Automation Logic

```
┌─────────────────────────────────────────────────────────────────┐
│                    SMART DECISION ENGINE                         │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ Motion   │───►│ Zone Timer   │───►│ LED ON/OFF   │          │
│  │ Detected │    │ (10s timeout)│    │ Command      │          │
│  └──────────┘    └──────────────┘    └──────────────┘          │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ Temp     │───►│ Threshold    │───►│ AC Speed     │          │
│  │ Reading  │    │ Check (25.5°)│    │ Command      │          │
│  └──────────┘    └──────────────┘    └──────────────┘          │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ Touch    │───►│ Presentation │───►│ All LEDs OFF │          │
│  │ Button   │    │ Mode Toggle  │    │ AC → SLOW    │          │
│  └──────────┘    └──────────────┘    └──────────────┘          │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ Override │───►│ Manual/Auto  │───►│ Direct       │          │
│  │ (Dash)   │    │ Flag Check   │    │ Command      │          │
│  └──────────┘    └──────────────┘    └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 💻 Tech Stack

| Layer              | Technology                                      |
|--------------------|--------------------------------------------------|
| **Language (Node A)** | Python 3                                         |
| **Language (Node B)** | Python 3                                         |
| **Language (Node C)** | JavaScript (ES Modules), React (JSX)             |
| **MQTT Broker**       | [Aedes](https://github.com/moscajs/aedes)        |
| **MQTT Client (Py)**  | [Paho MQTT](https://pypi.org/project/paho-mqtt/) |
| **MQTT Client (JS)**  | [mqtt.js](https://github.com/mqttjs/MQTT.js)     |
| **Web Framework**     | Express.js 5                                     |
| **Real-time**         | Socket.IO                                        |
| **Database**          | Redis + RedisOM                                  |
| **Frontend Build**    | Vite                                             |
| **UI Library**        | React 18                                         |
| **Charts**            | Chart.js + react-chartjs-2                       |
| **Icons**             | Lucide React                                     |
| **Hardware Library**  | gpiozero, RPi.GPIO, dht11, pigpio                |

---

## 📁 Project Structure

```
ComputerNetwork-Smart-Office/
├── requirements.txt                 # Python dependencies (Nodes A & B)
├── README.md                        # This file
│
├── node_a/                          # 📡 Sensor Node — Raspberry Pi A
│   └── python_sensor_node.py        # DHT11, 3× PIR, touch button → MQTT
│
├── node_b/                          # ⚡ Actuator Node — Raspberry Pi B
│   └── node_b_mqtt.py               # MQTT subscriber → 3× LEDs + Servo
│
└── node_c/                          # 🖥 Server & Dashboard — Raspberry Pi C
    ├── package.json                  # Node.js dependencies
    ├── vite.config.js                # Vite dev server + proxy config
    ├── index.html                    # HTML entry point
    ├── main.js                       # Express server + Aedes broker + Socket.IO
    ├── mqtt.js                       # MQTT client + Smart Decision Engine
    │
    ├── config/
    │   ├── redis.js                  # Redis client connection
    │   └── redisRepository.js        # RedisOM repositories (indexes)
    │
    ├── models/
    │   ├── temperature.js            # Temperature schema (RedisOM)
    │   ├── humidity.js               # Humidity schema (RedisOM)
    │   ├── motion.js                 # Motion schema (RedisOM)
    │   └── nodeBEvent.js             # Actuator event schema (RedisOM)
    │
    └── react-components/
        ├── main.jsx                  # React entry point
        ├── App.jsx                   # Main layout component
        ├── NetworkMap.jsx            # Live network topology & node health
        ├── Analytics.jsx             # Energy savings & ghost occupancy stats
        ├── ChartOverlay.jsx          # Temperature vs. AC utilization chart
        └── ControlPanel.jsx          # Manual override controls for devices
```

---

## 🔌 Hardware Requirements

### Node A — Sensor Node
| Component             | Qty  | Notes                          |
|-----------------------|------|--------------------------------|
| Raspberry Pi          | 1    | Any model with GPIO pins       |
| DHT11 Sensor          | 1    | Temperature & humidity         |
| PIR Motion Sensor     | 3    | HC-SR501 or similar            |
| Touch Sensor (Button) | 1    | Capacitive touch or push button|
| Jumper Wires          | —    | Female-to-Female               |
| Breadboard            | 1    | For wiring connections         |

### Node B — Actuator Node
| Component             | Qty  | Notes                          |
|-----------------------|------|--------------------------------|
| Raspberry Pi          | 1    | Any model with GPIO pins       |
| LED                   | 3    | Any color (represents lights)  |
| Servo Motor (SG90)    | 1    | Simulates AC vent control      |
| 220Ω Resistors        | 3    | For LEDs                       |
| Jumper Wires          | —    | Female-to-Female               |
| Breadboard            | 1    | For wiring connections         |

### Node C — Server Node
| Component             | Qty  | Notes                                  |
|-----------------------|------|----------------------------------------|
| Raspberry Pi          | 1    | Pi 3B+ or Pi 4 recommended (runs Node) |
| MicroSD Card          | 1    | 16GB+ with Raspberry Pi OS             |

### External PC
| Component    | Notes                                              |
|--------------|----------------------------------------------------|
| Any PC/Laptop| Connected to the same LAN; modern web browser      |

---

## 📦 Software Requirements

- **Raspberry Pi OS** (all 3 Pis) — Bookworm or later recommended
- **Python 3.11+** (Nodes A & B)
- **Node.js 18+** and **npm** (Node C)
- **Redis Server** (Node C) — must be installed and running
- **pigpio daemon** (Node B) — for precise servo PWM: `sudo pigpiod`

---

## 🚀 Installation & Setup

### Node A Setup

```bash
# 1. Clone the repository
git clone https://github.com/BlackberryDealer/ComputerNetwork-Smart-Office.git
cd ComputerNetwork-Smart-Office

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Set the broker IP via environment variable
export MQTT_BROKER_IP="<NODE_C_IP>"  # e.g. 192.168.1.100

# 4. Run the sensor node
python node_a/python_sensor_node.py
```

### Node B Setup

```bash
# 1. Clone the repository
git clone https://github.com/BlackberryDealer/ComputerNetwork-Smart-Office.git
cd ComputerNetwork-Smart-Office

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Start the pigpio daemon (required for servo)
sudo pigpiod

# 4. Set the broker IP via environment variable
export MQTT_BROKER_IP="<NODE_C_IP>"  # e.g. 192.168.1.100

# 5. Run the actuator node
python node_b/node_b_mqtt.py
```

### Node C Setup

```bash
# 1. Clone the repository
git clone https://github.com/BlackberryDealer/ComputerNetwork-Smart-Office.git
cd ComputerNetwork-Smart-Office/node_c

# 2. Install Redis (if not already installed)
sudo apt update
sudo apt install redis-server -y
sudo systemctl enable redis-server
sudo systemctl start redis-server

# 3. Install Node.js dependencies
npm install

# 4. (Optional) Create a .env file for configuration
cat > .env << EOF
PORT=3000
MQTT_BROKER_URL=mqtt://localhost:1883
REDIS_URL=redis://localhost:6379
EOF

# 5. Build the React frontend
npm run build

# 6. Start the server
npm start
```

The server will start:
- **MQTT Broker** on port `1883`
- **HTTP/WebSocket Server** on port `3000`

### External PC Setup

No installation required! Simply open a web browser on any device connected to the same LAN and navigate to:

```
http://<NODE_C_IP_ADDRESS>:3000
```

---

## ⚙️ Configuration

### Environment Variables (Node C — `.env`)

| Variable            | Default                  | Description                        |
|---------------------|--------------------------|------------------------------------|
| `PORT`              | `3000`                   | HTTP server port                   |
| `MQTT_BROKER_URL`   | `mqtt://localhost:1883`  | MQTT broker URL                    |
| `REDIS_URL`         | `redis://localhost:6379` | Redis connection URL               |

### Network Configuration

Before running the system, you **must** update the broker IP addresses in both Node A and Node B to point to Node C's LAN IP:

- **`node_a/python_sensor_node.py`** — Set `MQTT_BROKER_IP` environment variable or change default: `BROKER_IP = "<NODE_C_IP>"`
- **`node_b/node_b_mqtt.py`** — Set `MQTT_BROKER_IP` environment variable or change default: `BROKER_IP = "<NODE_C_IP>"`

> **Tip:** Use environment variables instead of editing code:
> ```bash
> export MQTT_BROKER_IP="192.168.x.x"
> python node_a/python_sensor_node.py
> ```

---

## 🛰 API Endpoints

Node C exposes the following REST API endpoints:

| Method | Endpoint                | Description                                        |
|--------|-------------------------|----------------------------------------------------|
| `GET`  | `/`                     | Serves the React dashboard                         |
| `GET`  | `/api/analytics`        | Energy savings & ghost occupancy analytics          |
| `GET`  | `/api/chart-data`       | Historical temp, AC, and motion data (query: `?minutes=N`) |
| `GET`  | `/api/active-commands`  | Current state of all devices (LEDs, AC, Presentation) |
| `GET`  | `/api/overrides`        | Current override settings for all devices           |
| `GET`  | `/api/nodes`            | Online/offline status of all nodes                  |
| `GET`  | `/api/presentation`     | Current presentation mode state                     |
| `POST` | `/api/overrides`        | Set device override (`{device_id, command}`)        |
| `POST` | `/api/presentation`     | Toggle presentation mode (`{mode: boolean}`)        |
| `POST` | `/mqtt/publish/:topic`  | Publish a raw MQTT message to any topic             |

#### Example: Override a device
```bash
# Manually turn on LED 1
curl -X POST http://<NODE_C_IP>:3000/api/overrides \
  -H "Content-Type: application/json" \
  -d '{"device_id": "LED_1", "command": "ON"}'

# Return LED 1 to auto mode
curl -X POST http://<NODE_C_IP>:3000/api/overrides \
  -H "Content-Type: application/json" \
  -d '{"device_id": "LED_1", "command": "AUTO"}'
```

---

## 📡 MQTT Topics

| Topic                        | Publisher   | Subscriber  | Payload Description                     |
|------------------------------|-------------|-------------|-----------------------------------------|
| `smartoffice/sensors`        | Node A      | Node C      | Climate, motion, and mode events        |
| `smartoffice/status/node_a`  | Node A      | Node C      | Online/offline status (retained + LWT)  |
| `smartoffice/status/node_b`  | Node B      | Node C      | Online/offline status + heartbeat       |
| `smartoffice/commands/node_b` | Node C      | Node B      | Device commands (LEDs, AC)              |

---

## ✨ Features

- **🚶 Motion-Based Lighting** — LEDs automatically turn on when someone is present and off after a 10-second vacancy.
- **🌡 Temperature-Responsive AC** — Servo speed adjusts based on real-time temperature thresholds.
- **🎬 Presentation Mode** — One-touch button dims all lights and slows the AC for presentations.
- **📊 Live Dashboard** — Real-time network topology map showing node health (online/offline with heartbeat monitoring).
- **📈 Analytics** — Tracks energy saved (kWh for LEDs and AC) and ghost occupancy corrections.
- **📉 Overlay Charts** — Temperature vs. AC utilization overlaid with motion zone activity.
- **🎛 Manual Overrides** — Dashboard toggle to manually control any device or return to smart AUTO mode.
- **💓 Heartbeat Monitoring** — Nodes A and B send periodic heartbeats; dashboard marks them offline after 15 seconds of silence.
- **🛡 Failsafe Timeout** — Node B auto-shuts down actuators if no MQTT command is received within 10 seconds.
- **🔄 LWT (Last Will and Testament)** — All nodes publish retained offline status on unexpected disconnection.
- **💾 Persistent Storage** — Redis stores all sensor readings and actuator events with time-series indexing via RedisOM.

---

## 📝 License

ISC License — See [package.json](node_c/package.json) for details.
