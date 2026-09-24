// Runs the in-browser model off the main thread, so the editor stays responsive while it thinks.
import { WebWorkerMLCEngineHandler } from "https://esm.run/@mlc-ai/web-llm@0.2.85";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = message => handler.onmessage(message);
