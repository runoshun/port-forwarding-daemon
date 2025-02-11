/**
 * Bundle TypeScript source files into a single string using deno_emit
 */

import { bundle } from "jsr:@deno/emit";

export class Bundler {
  /**
   * Bundle the source files starting from an entry point
   */
  async bundle(entryPoint: string): Promise<string> {
    try {
      const result = await bundle(entryPoint, {
        allowRemote: true,
        type: "module",
      });

      // Extract the bundled code
      const { code } = result;

      // Add source file header comment
      return `// Bundled from: ${entryPoint}\n${code}`;
    } catch (error) {
      console.error("Bundling error:", error);
      throw error;
    }
  }
}
