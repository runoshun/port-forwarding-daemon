import { BaseAgent } from "./base.ts";
import { DockerAgentManager } from "./manager/docker_agent_manager.ts";
import * as log from "../lib/logging.ts";

export class LocalAgent extends BaseAgent {
	private readonly dockerAgentManager: DockerAgentManager;

	constructor(private readonly forwardUrl: string) {
		super("LOCAL-AGENT", "/tmp/local_agent.pid");

		this.dockerAgentManager = new DockerAgentManager(this.forwardUrl, false);
	}

	override async start(): Promise<void> {
		await super.start();
		this.dockerAgentManager.start();
		log.info(`Local agent started, forward server: ${this.forwardUrl}`);
	}

	override async stop(): Promise<void> {
		await this.dockerAgentManager.stopAll();
		await super.stop();
	}
}
