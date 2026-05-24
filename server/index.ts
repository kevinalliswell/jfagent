import { createApiServer } from "./http.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const server = createApiServer();
server.listen(port, host, () => {
  console.log(`JF Agent API listening on http://${host}:${port}`);
});
