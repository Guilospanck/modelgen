// Web bundle entry. Engine code reads the Buffer global at call time; set it before anything runs.
import { Buffer } from "buffer";
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;

export * from "../../src/browser";
