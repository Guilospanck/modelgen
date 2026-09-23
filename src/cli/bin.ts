#!/usr/bin/env node
import { run } from "./main";

run(process.argv.slice(2)).then(
  code => { if (code !== null) process.exitCode = code; },
  e => { process.stderr.write(`modelgen: unexpected error: ${(e as Error).stack ?? e}\n`); process.exitCode = 1; },
);
