import { Schema } from "redis-om";

const humiditySchema = new Schema('humidity', {
    humidity: { type: 'number' },
    timestamp: { type: 'date' }
})

export default humiditySchema;
