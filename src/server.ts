import "dotenv/config";
import { createServer } from "node:http";
import { pool } from "./db";
import { createApp } from "./app";
import { attachWebSockets } from "./sockets";

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw new Error("Set JWT_SECRET to at least 32 random characters");
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env");
const app = createApp(pool, secret, (userId, notification) =>
  live.publish(userId, notification),
);
const server = createServer(app);
const live = attachWebSockets(server, pool, secret);
const port = Number(process.env.PORT || 3000);
server.listen(port, () =>
  console.log(
    `API listening at http://localhost:${port}; WebSocket: ws://localhost:${port}/ws`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    live.close();
    server.close(() => {
      pool.end().then(() => process.exit(0));
    });
  });
