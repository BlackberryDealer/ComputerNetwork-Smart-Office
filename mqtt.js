const mqtt = require('mqtt');

// Connect to a public test broker
const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

// Connection event
client.on('connect', () => {
    console.log('Connected to broker');

    // Subscribe to a topic
    client.subscribe('test/topic', (err) => {
        if (!err) {
            console.log('Subscribed to test/topic');

            // Publish a message
            client.publish('test/topic', 'Hello MQTT from Node.js!');
        }
    });
});

// Receive messages
client.on('message', (topic, message) => {
    console.log(`Received message on ${topic}: ${message.toString()}`);
});

// Error handling
client.on('error', (err) => {
    console.error('Connection error:', err);
});
