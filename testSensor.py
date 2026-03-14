import time
import json
import paho.mqtt.client as mqtt
import random

# # --- MQTT SETUP ---
BROKER_IP = "192.168.0.15"  
BROKER_PORT = 1883
TOPIC = "smartoffice/sensors"

# mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
# # try:
# #     mqtt_client.connect(BROKER_IP, BROKER_PORT, 60)
# #     mqtt_client.loop_start()  
# #     print(f"Connected to MQTT Broker at {BROKER_IP}")
# # except Exception as e:
# #     print(f"Failed to connect to MQTT broker: {e}")

# def publish_data(data_dict):
#     try:
#         json_payload = json.dumps(data_dict)
#         mqtt_client.publish(TOPIC, json_payload)
#     except Exception as e:
#         print(f"Failed to publish: {e}")

# def main():
#     try:
#         while True:
#             pass
#     except KeyboardInterrupt:
#         print("\nExiting gracefully.")
#     # finally:
#     #     # Safely clean up network and pins ONLY upon closing the program
#     #     mqtt_client.loop_stop()
#     #     mqtt_client.disconnect()
mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

mqtt_client.connect(BROKER_IP, BROKER_PORT)
mqtt_client.loop_start()

for i in range(30):
    message = f"Sending data number of times: {i}"
    json_payload = json.dumps({
        "motion": True,
        "temperature": random.randint(25, 39),
        "humidity": random.randint(70, 95)
    })
    mqtt_client.publish(TOPIC, json_payload)
    print(f"Published: {message}")
    time.sleep(1)

mqtt_client.loop_stop()
mqtt_client.disconnect()