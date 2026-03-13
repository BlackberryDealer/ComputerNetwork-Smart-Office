import { Repository } from "redis-om";
import redisClient from "./redis";

const humidityRepository = new Repository(humiditySchema, redisClient);
const temperatureRepository = new Repository(temperatureSchema, redisClient);
const motionRepository = new Repository(motionSchema, redisClient);

export { humidityRepository, temperatureRepository, motionRepository };
