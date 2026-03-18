import json
import time
import paho.mqtt.client as mqtt
from gpiozero import LED, Servo
from gpiozero.pins.pigpio import PiGPIOFactory

# Hardware Setup
factory = PiGPIOFactory()

leds = {
    "LED_1": LED(23, pin_factory=factory),
    "LED_2": LED(24, pin_factory=factory),
    "LED_3": LED(25, pin_factory=factory)
}
ac_servo = Servo(12, pin_factory=factory)

# Network Configuration (Must point to Node C!)
BROKER_IP = "10.137.164.56" # <--- Change this to Node C's Wi-Fi IP
COMMAND_TOPIC = "office/commands/node_b"
STATUS_TOPIC = "smartoffice/status/node_b"

# Global Variables
ac_mode = "OFF"
last_msg_time = {k: time.time() for k in ["LED_1", "LED_2", "LED_3", "AC"]}
timeout_triggered = {k: False for k in ["LED_1", "LED_2", "LED_3", "AC"]}

# Will and Testament logic
lwt_payload = json.dumps({"node": "Node B", "status": "offline"})
online_payload = json.dumps({"node": "Node B", "status": "online"})

def on_connect(client, userdata, flags, rc):
    print(f"Connected to Node C Broker on {BROKER_IP}")
    client.subscribe(COMMAND_TOPIC)
    client.publish(STATUS_TOPIC, online_payload, retain=True)
    print(f"Listening for commands on: {COMMAND_TOPIC}")

def on_message(client, userdata, msg):
    global ac_mode
    payload = msg.payload.decode("utf-8")
    
    try:
        data = json.loads(payload)
        device_id = data.get("device_id")
        command = data.get("command")
        
        if device_id in last_msg_time:
            last_msg_time[device_id] = time.time()
            timeout_triggered[device_id] = False
            
        # Act on LEDs
        if device_id in leds:
            if command == "ON":
                leds[device_id].on()
                print(f"{device_id} turned ON")
            elif command == "OFF":
                leds[device_id].off()
                print(f"{device_id} turned OFF")
                
        # Act on AC Servo
        elif device_id == "AC":
            if command in ["OFF", "SLOW", "FAST"]:
                ac_mode = command
                print(f"AC Mode updated to {ac_mode}")
                
    except json.JSONDecodeError:
        print("Invalid JSON received from server")

# Initialize MQTT Client
client = mqtt.Client()
client.will_set(STATUS_TOPIC, payload=lwt_payload, qos=1, retain=True)
client.on_connect = on_connect
client.on_message = on_message

try:
    print("Starting Actuator Node B")
    client.connect(BROKER_IP, 1883, 60)
    client.loop_start() 
    
    position = -1.0
    direction = 1
    step = 0.05
    
    last_ping_time = 0 # <-- ADD THIS before the loop

    while True:
        current_time = time.time()

        # --- ADD THIS NEW HEARTBEAT BLOCK ---
        # Publish a heartbeat every 5 seconds so the dashboard knows Node B is alive
        if current_time - last_ping_time > 5:
            client.publish("smartoffice/status/node_b", json.dumps({"status": "online"}))
            last_ping_time = current_time
        # ------------------------------------

        # Check for timeout per device
        for dev_id in leds:
            if current_time - last_msg_time[dev_id] > 10 and not timeout_triggered[dev_id]:
                print(f"Timeout: No commands for {dev_id} for 10 seconds. Turning OFF.")
                leds[dev_id].off()
                timeout_triggered[dev_id] = True
                
        if current_time - last_msg_time["AC"] > 10 and not timeout_triggered["AC"]:
            print("Timeout: No commands for AC for 10 seconds. Turning OFF.")
            ac_mode = "OFF"
            timeout_triggered["AC"] = True

        # Continuous AC Servo Sweeping (No timers, purely based on ac_mode state)
        if ac_mode == "OFF":
            time.sleep(0.5) 
        else:
            delay = 0.01 if ac_mode == "FAST" else 0.05
            
            ac_servo.value = position
            position += (step * direction)
            
            if position >= 1.0 or position <= -1.0:
                direction *= -1
                position = round(position) 
                
            time.sleep(delay)

except KeyboardInterrupt:
    print("\nShutting down Node B")
finally:
    client.loop_stop()
    for key in leds:
        leds[key].close()
    ac_servo.close()
    print("Hardware pins released safely")