import { Schema } from "redis-om";

const motionSchema = new Schema('motion', {
    motion: { type: 'boolean' },
    timestamp: { type: 'date', sortable: true }
})

export default motionSchema;
