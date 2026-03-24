import { spawn } from 'child_process';

import { LunaClient, type LunaResponse } from '@kitsuned/webos-luna-isomorphic-client';

import { isLegacyLunaSendRole } from './os-detect';

export type ExecBusConfig = {
	/**
	 * Corresponds to the `-a` flag.
	 * Available only for privileged (aka unjailed) services.
	 * Defaults to null on all webOS versions.
	 */
	appId?: string;

	/**
	 * Corresponds to the `-m` flag.
	 * Available for both jailed and privileged services.
	 * Defaults to `com.webos.lunasend[pub]-{pid}` on webOS >= 4.
	 * Defaults to null on webOS < 4.
	 */
	serviceId?: string;

	/**
	 * Forces setting a Service ID on webOS < 4 to spoof a system namespace.
	 *
	 * Warning: this prevents running multiple luna-send instances simultaneously,
	 * as the service name must be unique on the bus.
	 *
	 * Use only if required by the target service.
	 * Has no effect on webOS >= 4.
	 */
	preferExplicitServiceId?: boolean;
};

export class ExecBus extends LunaClient {
	public readonly id: string | null = null;

	private readonly command: string;
	private readonly extraArgs: string[] = [];

	public constructor(config: ExecBusConfig = {}) {
		super();

		const privileged = process.getuid!() === 0;

		// luna-send is not accessible in jail
		this.command = privileged ? 'luna-send' : 'luna-send-pub';

		if (config.serviceId) {
			this.id = config.serviceId;
			this.extraArgs.push('-m', this.id);
		} else if (isLegacyLunaSendRole && config.preferExplicitServiceId) {
			// the legacy luna-send[-pub] implementation sets neither service id nor app id,
			// so picky system services will not recognize the sender
			// see README for details
			this.id = privileged ? 'com.palm.lunasend' : 'com.palm.lunasendpub';
			this.extraArgs.push('-m', this.id);
		}

		if (config.appId) {
			if (!privileged) {
				throw new Error('ExecBus: cannot use appId in non-privileged context');
			}

			this.extraArgs.push('-a', config.appId);
		}
	}

	public override subscribe<T extends Record<string, any>>(
		uri: string,
		params: Record<string, any>,
		callback: (response: LunaResponse<T>) => void,
	): () => void {
		const child = spawn(
			this.command,
			[...this.extraArgs, '-i', uri, JSON.stringify(params)],
			// 'inherit' is not supported on node 0.10, pipe to stderr manually
			{ stdio: ['ignore', 'pipe', process.stderr] },
		);

		let buffer = '';

		child.stdout.setEncoding('utf8');

		child.stdout.on('data', (chunk: string) => {
			buffer += chunk;

			for (let nl = buffer.indexOf('\n'); nl !== -1; nl = buffer.indexOf('\n')) {
				const response = buffer.slice(0, nl);

				buffer = buffer.slice(nl + 1);

				callback(JSON.parse(response));
			}
		});

		child.on('close', code => {
			// the exit code if the child process exited on its own,
			// or null if the child process terminated due to a signal
			if (code === null) {
				return;
			}

			callback({
				returnValue: false,
				errorCode: -1,
				errorText: `${this.command} exited with non-zero code: ${code}`,
			});
		});

		return () => child.kill();
	}
}
