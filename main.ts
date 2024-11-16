import { SSHForwardingServer } from "./lib/ssh_forwarding.ts";
import { Bundler } from "./lib/bundler.ts";
import * as log from "./lib/logging.ts";
import * as settings from "./lib/settings.ts";

log.init("MAIN");

if (Deno.args.length !== 1) {
	console.error("Usage: deno run main.ts <remote-host>");
	Deno.exit(1);
}

const remoteHost = Deno.args[0];

// Bundle server codes
const bundler = new Bundler();
const remoteServerCode = await bundler.bundle(
	import.meta.resolve("./agent_ssh.ts"),
);
const dockerServerCode = await bundler.bundle(
	import.meta.resolve("./agent_docker.ts"),
);

// Combine both server codes with a separator
const combinedCode = `
// Docker server code
const dockerServerCode = ${JSON.stringify(dockerServerCode)};

// Remote server code
${remoteServerCode}
`;

// Start local SSH forwarding server
const sshForwardingManagerServer = new SSHForwardingServer({
	serverPort: settings.SSH_FORWARDING_MANAGER_PORT,
	controlPath: settings.SSH_MASTER_CONTROL_PATH,
	remoteHost: remoteHost,
});
sshForwardingManagerServer.start();

// Establish SSH connection and Start remote port watcher server
Deno.writeTextFileSync(settings.SSH_AGENT_SCRIPT_PATH, combinedCode);
const scpProcess = new Deno.Command("scp", {
	args: [
		settings.SSH_AGENT_SCRIPT_PATH,
		`${remoteHost}:${settings.SSH_AGENT_SCRIPT_PATH}`,
	],
	stdout: "null",
}).spawn();
await scpProcess.status;

const sshAgentProcess = new Deno.Command("ssh", {
	args: [
		"-tt",
		"-o",
		"ControlMaster=yes",
		"-o",
		`ControlPath=${sshForwardingManagerServer.sshControlPath}`,
		"-R",
		`${sshForwardingManagerServer.port}:localhost:${sshForwardingManagerServer.port}`,
		remoteHost,
		`~/.local/share/mise/shims/deno run -A ${settings.SSH_AGENT_SCRIPT_PATH} 'http://localhost:${sshForwardingManagerServer.port}'`,
	],
	stdin: "null",
}).spawn();

const cleanup = async () => {
	await sshForwardingManagerServer.stop();
	sshAgentProcess.kill("SIGTERM");
	Deno.exit(0);
};

Deno.addSignalListener("SIGINT", cleanup);
Deno.addSignalListener("SIGTERM", cleanup);
