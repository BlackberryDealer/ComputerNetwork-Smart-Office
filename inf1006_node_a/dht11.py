from time import sleep

def read_bus(file):
    # Open the specified sysfs file in read text mode
    f = open(file, "rt")
    # Read the first line of the file and convert it to an integer
    value = int(f.readline())
    # Close the file correctly (added parentheses to call the close method)
    f.close()
    return value

def dht11_val():
    # Initialize temperature (t) and humidity (h) to 0
    t = h = 0
    try:
        # Read the temperature value from the IIO device and convert it to Celsius
        # The value from the sensor is in millicelsius, so we divide by 1000
        t = read_bus("/sys/bus/iio/devices/iio:device0/in_temp_input") / 1000
        # Read the humidity value from the IIO device and convert it to a standard percentage
        # The value is in millipercent, so we divide by 1000
        h = read_bus("/sys/bus/iio/devices/iio:device0/in_humidityrelative_input") / 1000
    except Exception as e:
        # Print any exceptions that occur during file reading
        print(e)
        # Set both values to "N/A" to indicate an error reading the sensor
        t = h = "N/A"
    
    # Return a tuple containing the temperature and humidity
    return t, h

# Start an infinite loop to continuously read sensor data
while True:
    # Retrieve the latest temperature and humidity values
    (temp, hum) = dht11_val()
    
    # Check if we got valid readings (not "N/A")
    if temp != "N/A" and hum != "N/A":
        # Format and print the temperature and humidity values to 2 decimal places
        print("Temperature %(t)0.2f°C, Humidity: %(h)0.2f%%" % {"t": temp, "h": hum})
    
    # Wait for 1 second before taking the next reading
    sleep(1)
