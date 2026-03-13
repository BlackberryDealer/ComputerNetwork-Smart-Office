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

# Set how long the LED stays on after motion stops (in seconds)
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
                # Reset the countdown timer for this specific zone
                last_motion[zone] = time.time()
                print(f"Zone {zone} LED ON")
                
        # 2. Climate Logic
        elif msg_type == "climate" and not presentation_mode:
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
                print("Presentation Mode OFF. Normal operations resuming.")
                
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
        
        # Auto-turn off LEDs if the timeout duration has passed
        if not presentation_mode:
            for zone in leds:
                if leds[zone].is_active and (current_time - last_motion[zone] > MOTION_TIMEOUT):
                    leds[zone].off()
                    print(f"Zone {zone} empty for {MOTION_TIMEOUT}s. LED OFF.")

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