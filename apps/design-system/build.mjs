import { buildHome } from "../home/build.mjs";
console.log(JSON.stringify(await buildHome(), null, 2));
