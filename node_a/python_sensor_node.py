"""
Node A — Smart Office Sensor Node (Raspberry Pi)

Reads physical environmental data from DHT11, 3× PIR motion sensors,
and a touch button, then publishes to the MQTT broker on Node C.

Sensors:
  - DHT11 (GPIO 4): Temperature & Humidity, every 5 seconds
  - PIR Zone 1 (GPIO 18): Motion detection, every 2 seconds
  - PIR Zone 2 (GPIO 24): Motion detection, every 2 seconds
  - PIR Zone 3 (GPIO 22): Motion detection, every 2 seconds
  - Touch Button (GPIO 17): Presentation mode trigger, instant
"""

import time
import logging
import os
import json
import signal
import sys
import threading
from datetime import datetime

import paho.mqtt.client as mqtt
from gpiozero import MotionSensor, Button
import RPi.GPIO as GPIO
from dht11 import DHT11

# --- LOGGING SETUP ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("NodeA")

# --- CONFIGURATION ---
BROKER_IP = os.getenv("MQTT_BROKER_IP", "127.0.0.1")
BROKER_PORT = int(os.getenv("MQTT_BROKER_PORT", "1883"))
TOPIC = "smartoffice/sensors"
STATUS_TOPIC = "smartoffice/status/node_a"
DHT_READ_INTERVAL = 5.0   # seconds between DHT11 reads
MOTION_READ_INTERVAL = 2.0  # seconds between motion reads
MQTT_KEEPALIVE = 60

# --- THREAD SAFETY ---
publish_lock = threading.Lock()

# --- SHUTDOWN FLAG ---
_running = True


def _signal_handler(sig, frame):
    """Handle SIGINT/SIGTERM for graceful shutdown."""
    global _running
    logger.info("Received signal %s — shutting down gracefully...", sig)
    _running = False


signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)

# --- MQTT CALLBACKS ---

def on_connect(client, userdata, flags, reason_code, properties):
    """Called when the client connects to the broker."""
    if reason_code == 0:
        logger.info("Connected to MQTT broker at %s:%s", BROKER_IP, BROKER_PORT)
        client.publish(STATUS_TOPIC, online_payload, qos=1, retain=True)
    else:
        logger.error("Connection failed with reason code: %s", reason_code)


def on_disconnect(client, userdata, flags, reason_code, properties):
    """Called when the client disconnects — logs the event."""
    if reason_code != 0:
        logger.warning("Unexpected disconnect (rc=%s). Auto-reconnect will retry.", reason_code)
    else:
        logger.info("Disconnected from broker cleanly.")


# --- MQTT CLIENT SETUP ---
lwt_payload = json.dumps({"node": "node_a", "status": "offline"})
online_payload = json.dumps({"node": "node_a", "status": "online"})

mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
mqtt_client.will_set(STATUS_TOPIC, payload=lwt_payload, qos=1, retain=True)

# Enable automatic reconnection with exponential backoff
mqtt_client.reconnect_delay_set(min_delay=1, max_delay=30)

mqtt_client.on_connect = on_connect
mqtt_client.on_disconnect = on_disconnect


def publish_data(data_dict: dict) -> bool:
    """Publish a JSON payload to the sensor topic. Returns True on success."""
    with publish_lock:
        try:
            json_payload = json.dumps(data_dict)
            result = mqtt_client.publish(TOPIC, json_payload, qos=0)
            if result.rc != mqtt.MQTT_ERR_SUCCESS:
                logger.error("Publish failed with rc=%s", result.rc)
                return False
            return True
        except Exception as e:
            logger.error("Failed to publish: %s", e)
            return False


# --- HARDWARE SETUP ---
logger.info("Starting Smart Office Sensor Node (Node A)...")

try:
    pir_zone1 = MotionSensor(18)
    pir_zone2 = MotionSensor(24)
    pir_zone3 = MotionSensor(22)
    touch_sensor = Button(17)
except Exception as e:
    logger.error("Failed to initialize gpiozero sensors: %s", e)
    logger.info("Check wiring and that this is running on a Raspberry Pi.")
    sys.exit(1)

try:
    GPIO.setwarnings(False)
    GPIO.setmode(GPIO.BCM)
    dht_sensor = DHT11(pin=4)
except Exception as e:
    logger.error("Failed to initialize DHT11 sensor: %s", e)
    sys.exit(1)


# --- INSTANT EVENT HANDLERS ---
def touch_handler():
    """Handle presentation mode button press — fires instantly."""
    try:
        timestamp = datetime.now().isoformat()
        logger.info("Presentation mode activated!")
        publish_data({"type": "mode", "status": "presentation", "timestamp": timestamp})
    except Exception as e:
        logger.error("Touch handler error: %s", e)

touch_sensor.when_pressed = touch_handler


# --- CONNECT TO BROKER ---
try:
    mqtt_client.connect(BROKER_IP, BROKER_PORT, MQTT_KEEPALIVE)
    mqtt_client.loop_start()
except Exception as e:
    logger.error("Failed to connect to MQTT broker at %s:%s — %s", BROKER_IP, BROKER_PORT, e)
    logger.info("Check that the broker is running and BROKER_IP is correct.")
    GPIO.cleanup()
    sys.exit(1)

# --- MAIN PERIODIC LOOP ---
last_dht_read = 0.0
prev_motion_status = None  # Track previous motion state for deduplication

try:
    while _running:
        try:
            current_time = datetime.now().isoformat()

            # 1. MOTION SENSORS (fast read, every 2 seconds)
            motion_status = {
                "zone_1": bool(pir_zone1.value),
                "zone_2": bool(pir_zone2.value),
                "zone_3": bool(pir_zone3.value)
            }

            # Only publish if motion state actually changed since last read
            if motion_status != prev_motion_status:
                publish_data({
                    "type": "periodic_motion",
                    "states": motion_status,
                    "timestamp": current_time
                })
                prev_motion_status = motion_status.copy()
            else:
                logger.debug("Motion unchanged, skipping publish")

            # 2. DHT11 SENSOR (slow read, only every 5 seconds)
            if time.time() - last_dht_read >= DHT_READ_INTERVAL:
                result = dht_sensor.read()
                last_dht_read = time.time()

                if result is None:
                    logger.debug("DHT11 returned None. Retrying in %ss...", DHT_READ_INTERVAL)
                elif result.is_valid():
                    temp = result.temperature
                    humidity = result.humidity
                    logger.info(
                        "Temp: %.1f°C, Humidity: %.1f%% | Motion: Z1=%s Z2=%s Z3=%s",
                        temp, humidity,
                        motion_status['zone_1'], motion_status['zone_2'], motion_status['zone_3']
                    )

                    publish_data({
                        "type": "climate",
                        "temp": temp,
                        "humidity": humidity,
                        "timestamp": current_time
                    })
                else:
                    logger.debug(
                        "DHT11 read failed. Retrying in %ss...",
                        DHT_READ_INTERVAL
                    )

            # Sleep in small increments so signal handling is responsive
            for _ in range(int(MOTION_READ_INTERVAL * 10)):
                if not _running:
                    break
                time.sleep(0.1)

        except Exception as e:
            logger.error("Error in sensor loop: %s", e, exc_info=True)
            time.sleep(1)  # Avoid tight error loop

except Exception as e:
    logger.error("Fatal error: %s", e, exc_info=True)

finally:
    logger.info("Cleaning up...")
    try:
        mqtt_client.publish(STATUS_TOPIC, lwt_payload, qos=1, retain=True)
    except Exception:
        pass
    mqtt_client.loop_stop()
    mqtt_client.disconnect()
    GPIO.cleanup()
    logger.info("Node A shut down complete.")
