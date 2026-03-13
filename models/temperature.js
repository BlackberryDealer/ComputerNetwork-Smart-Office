import { Schema } from "redis-om";

const temperatureSchema = new Schema('temperature', {
    temperature: { type: 'number' },
    timestamp: { type: 'date' }
})

export default temperatureSchema;
