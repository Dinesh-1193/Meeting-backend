import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`MeetSpace API listening on http://localhost:${env.PORT}`);
  console.log(`CORS origin: ${env.CORS_ORIGIN}`);
  console.log(`LiveKit: ${env.LIVEKIT_URL}`);
});
