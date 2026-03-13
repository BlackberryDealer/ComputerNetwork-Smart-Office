import { Schema } from "redis-om";

const motionSchema = new Schema('motion', {
    motion: { type: 'number' },
    timestamp: { type: 'boolean' }
})

export default motionSchema;
