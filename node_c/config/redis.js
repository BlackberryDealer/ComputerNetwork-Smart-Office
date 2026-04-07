import { createClient } from "redis";

const redisClient = createClient({ 
    url: process.env.REDIS_URL,
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 20) {
                console.error('Redis: Max reconnection attempts reached.')
                return new Error('Redis reconnection failed')
            }
            return Math.min(retries * 100, 3000)
        },
        connectTimeout: 10_000,
    }
})

redisClient.on("error", (err) => {
    console.error("Redis Client Error:", err)
})

redisClient.on("reconnecting", () => {
    console.warn("Redis Client: Reconnecting...")
})

try {
    await redisClient.connect();
    console.log("Redis client connected successfully");
} catch (error) {
    console.error("Fatal: Cannot connect to Redis. Is Redis running?", error.message);
    process.exit(1);
}

export default redisClient;
