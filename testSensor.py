import paho.mqtt.client as mqtt
import json
import time
import random
from datetime import datetime

# Configuration
BROKER_IP = "127.0.0.1"
TOPIC = "smartoffice/sensors"

client = mqtt.Client()

def send_packet(data):
    payload = json.dumps(data)
    client.publish(TOPIC, payload)
    print(f"[SENT] {payload}")

try:
    client.connect(BROKER_IP, 1883, 60)
    print(f"Connected to local broker. Sending fake data to '{TOPIC}'...")

    while True:
        # 1. Simulate Climate Data (Every 5 seconds)
        # AC Logic: SLOW < 25.5°C, FAST > 25.5°C
        fake_temp = round(random.uniform(22.0, 28.0), 1)
        climate_data = {
            "type": "climate",
            "temp": fake_temp,
            "humidity": random.randint(40, 60),
            "timestamp": datetime.now().isoformat()
        }
        send_packet(climate_data)

        # 2. Simulate Motion Data
        # Logic: If all false, AC turns OFF after timeout
        motion_data = {
            "type": "periodic_motion",
            "states": {
                "zone_1": random.choice([True, False]),
                "zone_2": random.choice([True, False]),
                "zone_3": random.choice([True, False])
            },
            "timestamp": datetime.now().isoformat()
        }
        send_packet(motion_data)

        print("-" * 30)
        time.sleep(5)

except KeyboardInterrupt:
    print("Simulation stopped.")
    client.disconnect()