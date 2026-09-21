/** Registers the asset stub loader for test scripts that import app modules. */
import { register } from "node:module";
register("./asset-stub-loader.mjs", import.meta.url);
