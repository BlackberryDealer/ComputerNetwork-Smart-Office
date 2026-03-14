import json
import time
import paho.mqtt.client as mqtt
from gpiozero import LED, Servo
from gpiozero.pins.pigpio import PiGPIOFactory

# Hardware Setup
factory = PiGPIOFactory()

leds = {
    1: LED(23, pin_factory=factory),
    2: LED(24, pin_factory=factory),
    3: LED(25, pin_factory=factory)
}
ac_servo = Servo(12, pin_factory=factory)

# Network Configuration
BROKER_IP = "127.0.0.1" 
TEST_TOPIC = "smartoffice/sensors"

# Global Variables
ac_mode = "OFF"
presentation_mode = False
last_motion = {1: 0, 2: 0, 3: 0}
MOTION_TIMEOUT = 7.0 

def on_connect(client, userdata, flags, rc):
    print(f"Connected to Broker on {BROKER_IP}")
    client.subscribe(TEST_TOPIC)
    print(f"Listening to Node A on: {TEST_TOPIC}")

def on_message(client, userdata, msg):
    global ac_mode, presentation_mode, last_motion
    payload = msg.payload.decode("utf-8")
    
    try:
        data = json.loads(payload)
        msg_type = data.get("type")
        
        # 1. Motion Logic
        if msg_type == "motion" and not presentation_mode:
            zone = data.get("zone")
            if zone in leds:
                leds[zone].on()
                last_motion[zone] = time.time()
                print(f"Zone {zone} LED ON")
                
        # 2. Climate Logic with Occupancy Check
        elif msg_type == "climate" and not presentation_mode:
            current_time = time.time()
            is_room_empty = True
            
            # Verify if ANY zone is currently occupied
            for z in last_motion:
                if (current_time - last_motion[z]) <= MOTION_TIMEOUT:
                    is_room_empty = False
                    break
            
            # Only change AC settings if someone is in the room
            if not is_room_empty:
                temp = data.get("temp")
                if temp >= 28.0:
                    ac_mode = "FAST"
                elif temp >= 24.0:
                    ac_mode = "SLOW"
                else:
                    ac_mode = "OFF"
                print(f"Temp is {temp}C. AC adjusted to {ac_mode}")
            
        # 3. Presentation Mode Logic
        elif msg_type == "mode" and data.get("status") == "presentation":
            presentation_mode = not presentation_mode
            if presentation_mode:
                print("Presentation Mode ON")
                for key in leds:
                    leds[key].off()
                ac_mode = "SLOW"
            else:
                print("Presentation Mode OFF")
                
    except json.JSONDecodeError:
        print("Invalid JSON received")

# Initialize MQTT Client
client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

try:
    print("Starting Adaptive Node B Test Receiver")
    client.connect(BROKER_IP, 1883, 60)
    client.loop_start() 
    
    position = -1.0
    direction = 1
    step = 0.05
    
    while True:
        current_time = time.time()
        
        if not presentation_mode:
            is_room_empty = True
            
            # Check every zone for a timeout
            for zone in leds:
                if current_time - last_motion[zone] > MOTION_TIMEOUT:
                    if leds[zone].value == 1:
                        leds[zone].off()
                        print(f"Zone {zone} empty for {MOTION_TIMEOUT}s. LED OFF.")
                else:
                    is_room_empty = False

            # If every zone has timed out, force the AC off
            if is_room_empty and ac_mode != "OFF":
                ac_mode = "OFF"
                print("All zones empty. AC Auto-OFF.")

        # Continuous AC Servo Sweeping
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
    print("\nShutting down Node B test")
finally:
    client.loop_stop()
    for key in leds:
        leds[key].close()
    ac_servo.close()
    print("Hardware pins released safely")