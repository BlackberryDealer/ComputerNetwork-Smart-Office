#              .';:cc;.
#            .,',;lol::c.
#            ;';lddddlclo
#            lcloxxoddodxdool:,.
#            cxdddxdodxdkOkkkkkkkd:.
#          .ldxkkOOOOkkOO000Okkxkkkkx:.
#        .lddxkkOkOOO0OOO0000Okxxxxkkkk:
#       'ooddkkkxxkO0000KK00Okxdoodxkkkko
#      .ooodxkkxxxOO000kkkO0KOxolooxkkxxkl
#      lolodxkkxxkOx,.      .lkdolodkkxxxO.
#      doloodxkkkOk           ....   .,cxO;
#      ddoodddxkkkk:         ,oxxxkOdc'..o'
#      :kdddxxxxd,  ,lolccldxxxkkOOOkkkko,
#       lOkxkkk;  :xkkkkkkkkOOO000OOkkOOk.
#        ;00Ok' 'O000OO0000000000OOOO0Od.
#         .l0l.;OOO000000OOOOOO000000x,
#            .'OKKKK00000000000000kc.
#               .:ox0KKKKKKK0kdc,.
#                      ...
#
# Author: peppe8o
# Date: Nov 11th, 2024
# Version: 1.0

from time import sleep

def read_bus(file):
    f = open(file,"rt")
    value = int(f.readline())
    f.close
    return value

def dht11_val():
    t = h = 0
    try:
        t = read_bus("/sys/bus/iio/devices/iio:device0/in_temp_input")/1000
        h = read_bus("/sys/bus/iio/devices/iio:device0/in_humidityrelative_input")/1000
    except Exception as e:
        print(e)
        t = h = "N/A"
    return t, h

while True:
    (temp, hum) = dht11_val()
    if temp != "N/A" and hum != "N/A":
        print("Temperature %(t)0.2f°C, Humidity: %(h)0.2f%%" % {"t": temp, "h": hum})
    sleep(1)




