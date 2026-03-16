import { Schema } from "redis-om";

const motionSchema = new Schema('motion', {
    zone1: { type: 'boolean' },
    zone2: { type: 'boolean' },
    zone3: { type: 'boolean' },
    timestamp: { type: 'date', sortable: true }
})

export default motionSchema;
