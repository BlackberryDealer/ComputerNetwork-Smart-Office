import { Schema } from "redis-om";

const nodeBEventSchema = new Schema('nodeBEvent', {
  type: { type: 'string' },
  zone: { type: 'number' },
  temp: { type: 'number' },
  status: { type: 'string' },
  message: { type: 'text' },
  timestamp: { type: 'date' }
});

export default nodeBEventSchema;
