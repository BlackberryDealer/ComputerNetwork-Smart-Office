import { Schema } from "redis-om";

const humiditySchema = new Schema('humidity', {
    humidity: { type: 'number' },
    timestamp: { type: 'date', sortable: true }
})

export default humiditySchema;
