import paho.mqtt.client as mqtt
import json

BROKER_IP = "127.0.0.1"
BROKER_PORT = 1883
TOPIC = "smartoffice/sensors"

def on_message(client, userdata, msg):
    payload = json.loads(msg.payload.decode('utf-8'))
    print(f"--> Received via MQTT: {payload}")

# Added 'properties' to the end of the arguments list to match Version 2 requirements
def on_connect(client, userdata, flags, rc, properties):
    print(f"Connected to MQTT Broker! Subscribing to topic: '{TOPIC}'")
    client.subscribe(TOPIC)

print("Starting Node C Mock MQTT Receiver...")

# Declare VERSION2 here
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message

try:
    client.connect(BROKER_IP, BROKER_PORT, 60)
    client.loop_forever()
except KeyboardInterrupt:
    print("\nShutting down receiver.")
    client.disconnect()
