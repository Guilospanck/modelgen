// node:zlib for the web build: the two sync calls the engine makes, on fflate.
import { zlibSync, unzlibSync } from "fflate";
import { Buffer } from "buffer";

type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const deflateSync = (data: Uint8Array, opts: { level?: Level } = {}) => Buffer.from(zlibSync(data, { level: opts.level ?? 6 }));
export const inflateSync = (data: Uint8Array) => Buffer.from(unzlibSync(data));
