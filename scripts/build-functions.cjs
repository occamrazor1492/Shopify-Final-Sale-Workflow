const fs = require("fs/promises");
const path = require("path");
const esbuild = require("esbuild");

async function main() {
  const outdir = path.join(process.cwd(), "netlify", "functions-dist");
  await fs.rm(outdir, { recursive: true, force: true });
  await fs.mkdir(outdir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(process.cwd(), "netlify", "functions", "process.mjs")],
    outfile: path.join(outdir, "process.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    sourcemap: false,
    minify: false,
    legalComments: "none",
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
  });

  console.log("Bundled Netlify function to netlify/functions-dist/process.mjs");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
