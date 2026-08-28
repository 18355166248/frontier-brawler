#!/usr/bin/env node

import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("native/cocos-poc/assets/resources/generated-art");
await mkdir(output, { recursive: true });

for (const name of ["hero-v2.png", "enemy-grunt-v2.png"]) {
  await copyFile(resolve("public/art", name), resolve(output, name));
}

console.log(`[sync_cocos_art] wrote ${output}`);
