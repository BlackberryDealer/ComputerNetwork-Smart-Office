import { Repository } from "redis-om";
import redisClient from "./redis.js";
import humiditySchema from "../models/humidity.js";
import temperatureSchema from "../models/temperature.js";
import motionSchema from "../models/motion.js";
import nodeBEventSchema from "../models/nodeBEvent.js";

// Workaround for Redis error string differences: 'no such index' vs 'Unknown index name'
const originalDropIndex = Repository.prototype.dropIndex;
Repository.prototype.dropIndex = async function() {
  try {
    return await originalDropIndex.call(this);
  } catch (error) {
    const msg = error?.message?.toLowerCase?.() ?? "";
    if (msg.includes("no such index") || msg.includes("unknown index name")) {
      return;
    }
    throw error;
  }
};

const humidityRepository = new Repository(humiditySchema, redisClient);
const temperatureRepository = new Repository(temperatureSchema, redisClient);
const motionRepository = new Repository(motionSchema, redisClient);
const nodeBEventRepository = new Repository(nodeBEventSchema, redisClient);

async function ensureRepositoryIndex(repository, name) {
    try {
        await repository.createIndex();
        console.log(`Index created for ${name}`);
    } catch (error) {
        console.error(`Error creating index for ${name}:`, error);
    }
}

// Create all indexes in parallel for faster startup
await Promise.all([
  ensureRepositoryIndex(humidityRepository, 'humidity'),
  ensureRepositoryIndex(temperatureRepository, 'temperature'),
  ensureRepositoryIndex(motionRepository, 'motion'),
  ensureRepositoryIndex(nodeBEventRepository, 'nodeBEvent')
])

export { humidityRepository, temperatureRepository, motionRepository, nodeBEventRepository };
