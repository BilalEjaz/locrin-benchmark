#!/usr/bin/env node
import { runAction } from "./action/main.js";

const result = await runAction(process.env);
for (const line of result.log) console.log(line);
process.exitCode = result.code;
