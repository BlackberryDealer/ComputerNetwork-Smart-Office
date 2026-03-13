import time
import json
import paho.mqtt.client as mqtt
from gpiozero import MotionSensor, Button
import RPi.GPIO as GPIO
from dht11 import DHT11

# --- MQTT SETUP ---
BROKER_IP = "127.0.0.1"
BROKER_PORT = 1883
TOPIC = "smartoffice/sensors"

mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
try:
    mqtt_client.connect(BROKER_IP, BROKER_PORT, 60)
    mqtt_client.loop_start()
    print(f"Connected to MQTT Broker at {BROKER_IP}")
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

# --- EVENT HANDLERS ---
last_triggered = {1: 0, 2: 0, 3: 0}
COOLDOWN_SECONDS = 5
def motion_handler(zone):
    now = time.time()
    if now - last_triggered[zone] > COOLDOWN_SECONDS:
        last_triggered[zone] = now
        print(f"Motion detected in Zone {zone}!")
        publish_data({"type": "motion", "zone": zone, "status": "occupied"})

def touch_handler():
    print("Presentation mode activated!")
    publish_data({"type": "mode", "status": "presentation"})

pir_zone1.when_motion = lambda: motion_handler(1)
pir_zone2.when_motion = lambda: motion_handler(2)
pir_zone3.when_motion = lambda: motion_handler(3)
touch_sensor.when_pressed = touch_handler

# --- MAIN LOOP ---
try:
    while True:
        # Read DHT11
        result = dht_sensor.read()
        if result.is_valid():
            temp = result.temperature
            humidity = result.humidity
            print(f"Temp: {temp:.1f}°C, Humidity: {humidity:.1f}%")

            publish_data({
                "type": "climate",
                "temp": temp,
                "humidity": humidity
            })
        else:
            print("Failed to read DHT11 sensor, retrying...")

        # Wait 2 seconds before polling again
        time.sleep(2)

except KeyboardInterrupt:
    print("\nExiting gracefully.")
finally:
    # Safely clean up network and pins ONLY upon closing the program
    mqtt_client.loop_stop()
    mqtt_client.disconnect()
    GPIO.cleanup()

