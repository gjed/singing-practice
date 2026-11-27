import type { Transform } from "./golden.js";

/**
 * The function every golden fixture runs through: `.vex` text in, the value
 * stored in the matching `.json` out. Replace the body as engine steps land
 * (`parse` for the AST, then `parse` + `expand` for the event list).
 */
export const transform: Transform = () => {
  throw new Error("No golden transform registered: plug the engine into engine/test/transform.ts");
};
