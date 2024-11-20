import { existsSync } from "jsr:@std/fs";
import * as log from "../lib/logging.ts";

export abstract class BaseAgent {
	constructor(
		name: string,
		private readonly pidFilePath: string,
	) {
		log.init(name);

		if (existsSync(this.pidFilePath)) {
			const pid = Number.parseInt(Deno.readTextFileSync(this.pidFilePath));
			try {
				Deno.kill(pid, "SIGKILL");
			} catch (error) {
				log.error("Failed to kill previous process:", error);
			}
		}
		Deno.writeTextFileSync(this.pidFilePath, Deno.pid.toString());
	}

	async start(): Promise<void> {}

	async stop(): Promise<void> {
		await Deno.remove(this.pidFilePath);
	}
}
