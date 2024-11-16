import * as log from "jsr:@std/log";

const LOG_LEVEL = "DEBUG";

export const init = (tag: string) => {
	log.setup({
		handlers: {
			console: new log.ConsoleHandler("DEBUG", {
				formatter: (r) => `[${tag}][${r.levelName}] ${r.msg}`,
			}),
		},
		loggers: {
			default: {
				level: LOG_LEVEL,
				handlers: ["console"],
			},
		},
	});
};

export const info = log.info;
export const debug = log.debug;
export const error = log.error;
export const warn = log.warn;
