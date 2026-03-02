import time
from gpiozero import MotionSensor, Button
from dht11 import DHT11

# Setup digital inputs using the gpiozero library
# Initialize PIR motion sensor for Zone 1 attached to GPIO pin 18
pir_zone1 = MotionSensor(18)
# Initialize PIR motion sensor for Zone 2 attached to GPIO pin 27
pir_zone2 = MotionSensor(27)
# Initialize PIR motion sensor for Zone 3 attached to GPIO pin 22
pir_zone3 = MotionSensor(22)
# Initialize a touch sensor (or button) attached to GPIO pin 17
touch_sensor = Button(17)

# Setup DHT11 temperature and humidity sensor
# It is connected to BCM GPIO pin 26 (which is Physical Pin 37 on the Raspberry Pi)
dht_sensor = DHT11(pin=26)

# Print a startup message to indicate the script is running
print("Starting Smart Office Sensor Node (Python Node A)...")

# Dictionary to keep track of the last time motion was detected in each zone (in epoch seconds)
last_triggered = {1: 0, 2: 0, 3: 0}
# Define a cooldown period (in seconds) to prevent spamming motion detection events
COOLDOWN_SECONDS = 5

def motion_handler(zone):
    # Get the current time in epoch seconds
    now = time.time()
    # Check if the time elapsed since the last trigger is greater than the cooldown period
    if now - last_triggered[zone] > COOLDOWN_SECONDS:
        # Update the last triggered time to the current time
        last_triggered[zone] = now
        # Print a message indicating motion was detected in the specific zone
        print(f"Motion detected in Zone {zone}!")

# Assign the motion_handler function to the when_motion event of each PIR sensor
# A lambda function is used to pass the specific zone number to the handler
pir_zone1.when_motion = lambda: motion_handler(1)
pir_zone2.when_motion = lambda: motion_handler(2)
pir_zone3.when_motion = lambda: motion_handler(3)

# Assign a lambda function to print a message when the touch sensor is pressed
touch_sensor.when_pressed = lambda: print("Presentation mode activated!")

try:
    # Start an infinite loop to continuously read from the DHT11 sensor
    while True:
        # Read the temperature and humidity from the DHT11 sensor
        result = dht_sensor.read()
        
        # Check if the reading is valid (no errors occurred during data transmission)
        if result.is_valid():
            # Format and print the temperature and humidity to 1 decimal place
            print(f"Temp: {result.temperature:.1f}°C, Humidity: {result.humidity:.1f}%")
        else:
            # If the reading is not valid (e.g., missed a pulse), simply pass and try again on the next iteration
            pass
            
        # Wait for 2 seconds before the next reading
        # The DHT11 sensor requires at least 2 seconds between reads to function correctly
        time.sleep(2)

except KeyboardInterrupt:
    # Catch a KeyboardInterrupt (e.g., when the user presses Ctrl+C) to exit cleanly
    print("\nExiting gracefully.")
