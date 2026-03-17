import time
from datetime import datetime
import json
import paho.mqtt.client as mqtt
from gpiozero import MotionSensor, Button
import RPi.GPIO as GPIO
from dht11 import DHT11

# --- MQTT SETUP ---
BROKER_IP = "127.0.0.1"
BROKER_PORT = 1883
TOPIC = "smartoffice/sensors"
STATUS_TOPIC = "smartoffice/status/node_a"

# Last Will and Testament
lwt_payload = json.dumps({"node": "Node A", "status": "offline"})
online_payload = json.dumps({"node": "Node A", "status": "online"})

mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
mqtt_client.will_set(STATUS_TOPIC, payload=lwt_payload, qos=1, retain=True)

try:
    mqtt_client.connect(BROKER_IP, BROKER_PORT, 60)
    mqtt_client.loop_start()
    print(f"Connected to MQTT Broker at {BROKER_IP}")
    # Publish online status
    mqtt_client.publish(STATUS_TOPIC, online_payload, retain=True)
except Exception as e:
    print(f"Failed to connect to MQTT broker: {e}")

def publish_data(data_dict):
    try:
        json_payload = json.dumps(data_dict)
        mqtt_client.publish(TOPIC, json_payload)
    except Exception as e:
        print(f"Failed to publish: {e}")

# --- HARDWARE SETUP ---
print("Starting Smart Office Sensor Node (Python Node A)...")

# 1. Setup gpiozero sensors first
pir_zone1 = MotionSensor(18)
pir_zone2 = MotionSensor(24)
pir_zone3 = MotionSensor(22)
touch_sensor = Button(17)

# 2. Setup DHT11 using the RPi.GPIO standard (DO NOT USE cleanup() HERE)
GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)
dht_sensor = DHT11(pin=4)  # Ensure this matches your physical wiring

# --- INSTANT EVENT HANDLERS ---
# The presentation button still acts instantly
def touch_handler():
    timestamp = datetime.now().isoformat()
    print("Presentation mode activated!")
    publish_data({"type": "mode", "status": "presentation", "timestamp": timestamp})

touch_sensor.when_pressed = touch_handler
# --- MAIN PERIODIC LOOP ---
last_dht_read = 0  # Tracker for the 5-second DHT delay

try:
    while True:
        current_time = datetime.now().isoformat()

        # 1. MOTION SENSORS (Reads fast, every 2 seconds)
        motion_status = {
            "zone_1": bool(pir_zone1.value),
            "zone_2": bool(pir_zone2.value),
            "zone_3": bool(pir_zone3.value)
        }

        publish_data({
            "type": "periodic_motion",
            "states": motion_status,
            "timestamp": current_time
        })

        # 2. DHT11 SENSOR (Reads slowly, only every 5 seconds)
        if time.time() - last_dht_read >= 5.0:
            result = dht_sensor.read()
            last_dht_read = time.time() # Reset the timer

            if result.is_valid():
                temp = result.temperature
                humidity = result.humidity
                print(f"Temp: {temp:.1f}°C, Humidity: {humidity:.1f}% | Motion: Z1={motion_status['zone_1']} Z2={motion_status['zone_2']} Z3={motion_status['zone_3']}")

                publish_data({
                    "type": "climate",
                    "temp": temp,
                    "humidity": humidity,
                    "timestamp": current_time
                })
            else:
                # Silently fail so it doesn't spam the console, it will just try again in 5 seconds
                print(f"DHT11 read failed. Retrying in 5s... | Motion: Z1={motion_status['zone_1']} Z2={motion_status['zone_2']} Z3={motion_status['zone_3']}")

        # Keep the fast loop running every 2 seconds for the motion sensors
        time.sleep(2)

except KeyboardInterrupt:
    print("\nExiting gracefully.")
finally:
    mqtt_client.loop_stop()
    mqtt_client.disconnect()
    GPIO.cleanup()
