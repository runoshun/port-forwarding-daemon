import { dirname } from "./deps.ts";

import { SSHRemoteAgent } from "./agent/ssh.ts";
import { DockerContainerAgent } from "./agent/docker-container.ts";
import * as log from "./lib/logging.ts";
import { SSHAgentManager } from "./agent/manager/ssh_agent_manager.ts";
import { LocalAgent } from "./agent/local.ts";
import * as settings from "./lib/settings.ts";
import { SSHForwardingServer } from "./lib/forwarder/ssh.ts";
import { Bundler } from "./lib/bundler.ts";

log.init("MAIN");

const main = async () => {
	const command = Deno.args[0];
	const args = Deno.args.slice(1);

	switch (command) {
		case "start":
			await start(args);
			break;
		case "ssh":
			start_ssh_agent(args);
			break;
		case "docker":
			start_docker_agent(args);
			break;
		default:
			log.error("Unknown command:", command);
			Deno.exit(1);
	}
};

const start = async (args: string[]) => {
	if (args.length < 1) {
		log.error("Usage: start <remote_host>");
		Deno.exit(1);
	}
	const remoteHost = args[0];
	const bundler = new Bundler();
	const bundledCode = await bundler.bundle(Deno.mainModule);
	Deno.mkdirSync(dirname(settings.MAIN_SCRIPT_PATH), { recursive: true });
	Deno.writeTextFileSync(settings.MAIN_SCRIPT_PATH, bundledCode);

	const sshForwardingManagerServer = new SSHForwardingServer({
		serverPort: settings.SSH_FORWARDING_MANAGER_PORT,
		controlPath: settings.SSH_MASTER_CONTROL_PATH,
		remoteHost: remoteHost,
	});

	const sshAgentManager = new SSHAgentManager(sshForwardingManagerServer);
	const localAgent = new LocalAgent(
		`http://localhost:${sshForwardingManagerServer.port}`,
	);

	sshForwardingManagerServer.start();
	await sshAgentManager.start();
	await localAgent.start();

	const cleanup = async () => {
		await sshAgentManager.stop();
		log.debug("sshAgentManager stopped");
		await localAgent.stop();
		log.debug("localAgent stopped");
		await sshForwardingManagerServer.stop();
		log.debug("sshForwardingManagerServer stopped");
		Deno.exit(0);
	};

	Deno.addSignalListener("SIGINT", cleanup);
	Deno.addSignalListener("SIGTERM", cleanup);
};

const start_ssh_agent = (args: string[]) => {
	const forwardingManagerUrl = args[0];
	const agent = new SSHRemoteAgent(forwardingManagerUrl, true);
	agent.start();

	const cleanup = async () => {
		await agent.stop();
		log.debug("SSH agent stopped");
		Deno.exit(0);
	};
	Deno.addSignalListener("SIGINT", cleanup);
	Deno.addSignalListener("SIGTERM", cleanup);
};

const start_docker_agent = (args: string[]) => {
	const forwardingManagerUrl = args[0];
	const agent = new DockerContainerAgent(forwardingManagerUrl);
	agent.start();

	const cleanup = async () => {
		await agent.stop();
		log.debug("Docker agent stopped");
		Deno.exit(0);
	};
	Deno.addSignalListener("SIGINT", cleanup);
	Deno.addSignalListener("SIGTERM", cleanup);
};

main();
