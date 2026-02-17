#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import { run } from "./src/cli.ts";

await run(Deno.args);
