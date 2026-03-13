import mqtt from 'mqtt'

const brokerUrl = process.env.MQTT_BROKER_URL

// Connect to a public test broker
const client = mqtt.connect(brokerUrl);

// Connection event
client.on('connect', () => {
    console.log('Connected to broker');

    // Subscribe to a topic
    client.subscribe('test/topic', (err) => {
        if (!err) {
            console.log('Subscribed to test/topic');

        }
    });
    // Publish a message
    // client.publish('test/topic', 'Hello World!!!');
});

// Receive messages
client.on('message', (topic, message) => {
    console.log(`Received message on ${topic}: ${message.toString()}`);

    const data = message.toString();
    console.log("Received data:", data);

    const parsedData = JSON.parse(data);
    console.log("Parsed data:", parsedData);
    console.log("Temperature:", parsedData.data);
});

// Error handling
client.on('error', (err) => {
    console.error('Connection error:', err);
});
