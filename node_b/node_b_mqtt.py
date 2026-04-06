"""
Node B — Smart Office Actuator Node (Raspberry Pi)

Subscribes to command topics from Node C's MQTT broker and controls
physical actuators (3× LEDs for zone lighting, 1× servo for AC vent).

Actuators:
  - LED 1 (GPIO 23): Zone 1 lighting
  - LED 2 (GPIO 24): Zone 2 lighting
  - LED 3 (GPIO 25): Zone 3 lighting
  - Servo (GPIO 12): AC vent speed control (OFF / SLOW / FAST)

Safety:
  - 10-second timeout: devices auto-OFF if no command received
  - LWT: publishes offline status on unexpected disconnect
  - Heartbeat: publishes online status every 2 seconds
"""

import json
import time
import logging
import os
import signal
import sys
import threading
from datetime import datetime

import paho.mqtt.client as mqtt
from gpiozero import LED, Servo
from gpiozero.pins.pigpio import PiGPIOFactory

# --- LOGGING SETUP ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("NodeB")

# --- CONFIGURATION ---
BROKER_IP = os.getenv("MQTT_BROKER_IP", "localhost")
BROKER_PORT = int(os.getenv("MQTT_BROKER_PORT", "1883"))
COMMAND_TOPIC = "smartoffice/commands/node_b"
STATUS_TOPIC = "smartoffice/status/node_b"
IDLE_TIMEOUT = 10         # seconds before device auto-shutoff
STARTUP_GRACE_PERIOD = 30  # seconds grace before first timeout kicks in
HEARTBEAT_INTERVAL = 2    # seconds between heartbeat publishes
MQTT_KEEPALIVE = 60
SERVO_MIN = -1.0
SERVO_MAX = 1.0
SWEEP_STEP = 0.05
FAST_DELAY = 0.01
SLOW_DELAY = 0.05
ACK_TOPIC = "smartoffice/acks/node_b"

# Validate servo bounds are within gpiozero Servo range
assert -1.0 <= SERVO_MIN < SERVO_MAX <= 1.0, "Servo bounds must be in [-1.0, 1.0] range"

# Valid commands whitelist
VALID_DEVICE_IDS = {"LED_1", "LED_2", "LED_3", "AC"}
VALID_LED_COMMANDS = {"ON", "OFF"}
VALID_AC_COMMANDS = {"OFF", "SLOW", "FAST"}

# --- THREAD SAFETY ---
state_lock = threading.Lock()

# --- SHUTDOWN FLAG ---
_running = True


def _signal_handler(sig, frame):
    """Handle SIGINT/SIGTERM for graceful shutdown."""
    global _running
    logger.info("Received signal %s — shutting down gracefully...", sig)
    _running = False


signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)

# --- HARDWARE SETUP ---
logger.info("Starting Actuator Node B...")

try:
    factory = PiGPIOFactory()
except Exception as e:
    logger.error("Failed to initialize PiGPIOFactory. Is pigpio daemon running? (sudo pigpiod)")
    logger.error("Error: %s", e)
    sys.exit(1)

try:
    leds = {
        "LED_1": LED(23, pin_factory=factory),
        "LED_2": LED(24, pin_factory=factory),
        "LED_3": LED(25, pin_factory=factory)
    }
    ac_servo = Servo(12, pin_factory=factory)
except Exception as e:
    logger.error("Failed to initialize GPIO devices: %s", e)
    sys.exit(1)

# --- STATE ---
ac_mode = "OFF"
_start_time = time.time()  # Track startup for grace period
# Initialize with None — timeout only activates after first command or grace period expires
last_msg_time = {k: None for k in ["LED_1", "LED_2", "LED_3", "AC"]}
timeout_triggered = {k: False for k in ["LED_1", "LED_2", "LED_3", "AC"]}

# --- MQTT CALLBACKS ---
lwt_payload = json.dumps({"node": "node_b", "status": "offline"})
online_payload = json.dumps({"node": "node_b", "status": "online"})


def on_connect(client, userdata, flags, reason_code, properties):
    """Called when the client connects to the broker."""
    global _start_time
    if reason_code == 0:
        logger.info("Connected to Node C broker at %s:%s", BROKER_IP, BROKER_PORT)
        client.subscribe(COMMAND_TOPIC, qos=1)
        client.publish(STATUS_TOPIC, online_payload, qos=1, retain=True)
        logger.info("Listening for commands on: %s", COMMAND_TOPIC)
        # Reset startup grace period and timeout timers on reconnect
        _start_time = time.time()
        for dev_id in last_msg_time:
            last_msg_time[dev_id] = None
            timeout_triggered[dev_id] = False
    else:
        logger.error("Connection failed with reason code: %s", reason_code)


def on_disconnect(client, userdata, flags, reason_code, properties):
    """Called when the client disconnects — logs the event."""
    if reason_code != 0:
        logger.warning("Unexpected disconnect (rc=%s). Auto-reconnect will retry.", reason_code)
    else:
        logger.info("Disconnected from broker cleanly.")


def on_message(client, userdata, msg):
    """Handle incoming commands from Node C."""
    payload = msg.payload.decode("utf-8")

    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        logger.warning("Invalid JSON received: %s", payload[:100])
        return

    device_id = data.get("device_id")
    command = data.get("command")

    # Validate device_id
    if device_id not in VALID_DEVICE_IDS:
        logger.warning("Unknown device_id: %s", device_id)
        return

    # Validate command
    if device_id == "AC":
        if command not in VALID_AC_COMMANDS:
            logger.warning("Invalid AC command: %s", command)
            return
    elif device_id in leds:
        if command not in VALID_LED_COMMANDS:
            logger.warning("Invalid LED command: %s", command)
            return

    with state_lock:
        last_msg_time[device_id] = time.time()
        timeout_triggered[device_id] = False

        # Act on LEDs
        if device_id in leds:
            if command == "ON":
                leds[device_id].on()
                logger.info("%s turned ON", device_id)
            elif command == "OFF":
                leds[device_id].off()
                logger.info("%s turned OFF", device_id)

        # Act on AC Servo
        elif device_id == "AC":
            global ac_mode
            ac_mode = command
            logger.info("AC Mode updated to %s", ac_mode)

        # Publish acknowledgment back to Node C
        ack_payload = json.dumps({
            "device_id": device_id,
            "status": command,
            "timestamp": datetime.now().isoformat()
        })
        client.publish(ACK_TOPIC, ack_payload, qos=1)


# --- INITIALIZE MQTT CLIENT ---
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.will_set(STATUS_TOPIC, payload=lwt_payload, qos=1, retain=True)

# Enable automatic reconnection with exponential backoff
client.reconnect_delay_set(min_delay=1, max_delay=30)

client.on_connect = on_connect
client.on_disconnect = on_disconnect
client.on_message = on_message

# --- CONNECT ---
try:
    client.connect(BROKER_IP, BROKER_PORT, MQTT_KEEPALIVE)
    client.loop_start()
except Exception as e:
    logger.error("Failed to connect to MQTT broker at %s:%s — %s", BROKER_IP, BROKER_PORT, e)
    for led in leds.values():
        try:
            led.close()
        except Exception:
            pass
    try:
        ac_servo.close()
    except Exception:
        pass
    sys.exit(1)

# --- MAIN LOOP ---
position = -1.0
direction = 1
last_ping_time = 0.0

try:
    while _running:
        try:
            current_time = time.time()

            # Heartbeat: publish online status with device states every 2 seconds
            if current_time - last_ping_time > HEARTBEAT_INTERVAL:
                with state_lock:
                    heartbeat_payload = json.dumps({
                        "status": "online",
                        "devices": {
                            dev: ("ON" if led.is_lit else "OFF") for dev, led in leds.items()
                        },
                        "ac_mode": ac_mode
                    })
                client.publish(STATUS_TOPIC, heartbeat_payload, qos=1)
                last_ping_time = current_time

            # Check for timeout per device (thread-safe read)
            # Skip timeout check during startup grace period and before first command
            in_grace_period = (current_time - _start_time) < STARTUP_GRACE_PERIOD
            with state_lock:
                for dev_id in leds:
                    if (not in_grace_period
                            and last_msg_time[dev_id] is not None
                            and current_time - last_msg_time[dev_id] > IDLE_TIMEOUT
                            and not timeout_triggered[dev_id]):
                        logger.warning("Timeout: No commands for %s for %ss. Turning OFF.", dev_id, IDLE_TIMEOUT)
                        leds[dev_id].off()
                        timeout_triggered[dev_id] = True

                if (not in_grace_period
                        and last_msg_time["AC"] is not None
                        and current_time - last_msg_time["AC"] > IDLE_TIMEOUT
                        and not timeout_triggered["AC"]):
                    logger.warning("Timeout: No commands for AC for %ss. Turning OFF.", IDLE_TIMEOUT)
                    ac_mode = "OFF"
                    timeout_triggered["AC"] = True

                current_ac_mode = ac_mode

            # Continuous AC Servo Sweeping (state_lock protects position/direction)
            if current_ac_mode == "OFF":
                time.sleep(0.05)
            else:
                delay = FAST_DELAY if current_ac_mode == "FAST" else SLOW_DELAY

                with state_lock:
                    try:
                        ac_servo.value = position
                    except Exception as e:
                        logger.error("Servo write error: %s", e)

                    position += SWEEP_STEP * direction

                    # Clamp to bounds and reverse direction at endpoints
                    if position >= SERVO_MAX:
                        position = SERVO_MAX
                        direction = -1
                    elif position <= SERVO_MIN:
                        position = SERVO_MIN
                        direction = 1

                time.sleep(delay)

        except Exception as e:
            logger.error("Error in main loop: %s", e, exc_info=True)
            time.sleep(1)  # Avoid tight error loop

except Exception as e:
    logger.error("Fatal error: %s", e, exc_info=True)

finally:
    logger.info("Shutting down Node B...")
    try:
        client.publish(STATUS_TOPIC, lwt_payload, qos=1, retain=True)
    except Exception:
        pass
    client.loop_stop()
    client.disconnect()

    # Reset hardware to safe state before closing
    for key in leds:
        try:
            leds[key].off()
            leds[key].close()
        except Exception:
            pass
    try:
        ac_servo.value = 0  # Neutral position
        ac_servo.close()
    except Exception:
        pass

    logger.info("Hardware pins released safely.")