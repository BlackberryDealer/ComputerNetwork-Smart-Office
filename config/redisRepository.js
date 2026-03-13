import { Repository } from "redis-om";
import redisClient from "./redis.js";
import humiditySchema from "../models/humidity.js";
import temperatureSchema from "../models/temperature.js";
import motionSchema from "../models/motion.js";

const humidityRepository = new Repository(humiditySchema, redisClient);
const temperatureRepository = new Repository(temperatureSchema, redisClient);
const motionRepository = new Repository(motionSchema, redisClient);

// Create Redis index for each repository
// await humidityRepository.createIndex();
// await temperatureRepository.createIndex();
// await motionRepository.createIndex();

export { humidityRepository, temperatureRepository, motionRepository };
