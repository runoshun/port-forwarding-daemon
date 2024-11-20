export const LOG_LEVEL = "DEBUG";

export const SSH_FORWARDING_MANAGER_PORT = 19876;
export const SSH_MASTER_CONTROL_PATH = `/tmp/ssh_mux_%h_%p_%r`;

export const MAIN_SCRIPT_PATH = "/tmp/port-forwarding-daemon/main.js";
export const DENO_INSTALL_PATH = "/tmp/port-forwarding-daemon/deno";
export const DOCKER_CONTAINER_LABEL = "auto.port.forwarding.enabled";

export const COMMANDS = {
	SSH: "ssh",
	DOCKER: "docker",
};
