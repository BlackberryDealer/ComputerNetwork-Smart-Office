import { createClient } from "redis";

const redisClient = createClient({ 
    url: process.env.REDIS_URL
})

redisClient.on("error", (err) => {
    console.error("Redis Client Error:", err)
})

try {
    await redisClient.connect();
    console.log("Redis client connected successfully");
} catch (error) {
    console.error("Fatal: Cannot connect to Redis. Is Redis running?", error.message);
    process.exit(1);
}

export default redisClient;
