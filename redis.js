import { createClient } from "redis";

const client = await createClient({ url: process.env.REDIS_URL })
  .on("error", (err) => console.log("Redis Client Error", err))
  .connect();

await client.set("key", "test value");
const value = await client.get("key");
console.log(value)
client.destroy();
