import { parse } from "../src/index.js";
import type { Transform } from "./golden.js";

/**
 * The function every golden fixture runs through: `.vex` text in, the value stored in the matching
 * `.json` out. Today it is the `parse` result, AST or errors. When `expand` lands, event-list fixtures
 * go through `parse` followed by `expand`.
 */
export const transform: Transform = (source) => parse(source);
