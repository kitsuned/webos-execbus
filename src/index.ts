import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

import { AsyncSink } from '@kitsuned/async-utils';

import { isLegacyBus } from '@kitsuned/webos-service';
import type { Client, LunaResponse } from '@kitsuned/webos-service';

type AnyRecord = Record<string, any>;

export type ExecBusConfig = {
	appId?: string;
	serviceId?: string;
};

function generateId(size: number = 4): string {
	return randomBytes(size).toString('hex');
}

export class ExecBus implements Client {
	public readonly id: string | null = null;

	private readonly command: string;
	private readonly extraArgs: (string | (() => string))[] = [];

	public constructor(config: ExecBusConfig = {}) {
		const privileged = process.getuid!() === 0;

		// luna-send is not accessible in jail
		this.command = privileged ? '/usr/bin/luna-send' : '/usr/bin/luna-send-pub';

		if (config.serviceId) {
			this.id = config.serviceId;
			this.extraArgs.push('-m', config.serviceId);
		} else if (isLegacyBus) {
			// the legacy luna-send[-pub] implementation sets neither service id nor app id,
			// so services will not recognize the sender
			//
			// while we could use `com.palm.lunasend[pub]`, that would prevent running parallel
			// luna-send instances due to a service name conflict
			//
			// obviously, i don't want to introduce mutexes into this library
			//
			// so, i borrow `com.palm.luna-*` from com.palm.webappmgr
			this.extraArgs.push('-m', () => `com.palm.luna-${process.pid}-execbus-${generateId()}`);
		}

		if (config.appId) {
			if (!privileged) {
				throw new Error('ExecBus: cannot use appId in non-privileged context');
			}

			this.extraArgs.push('-a', config.appId);
		}
	}

	public oneshot<T extends AnyRecord>(
		uri: string,
		params: AnyRecord = {},
	): Promise<LunaResponse<T>> {
		return new Promise(resolve => {
			const cancel = this.subscribe<T>(uri, params, response => {
				cancel();

				resolve(response);
			});
		});
	}

	public subscribe<T extends AnyRecord>(
		uri: string,
		params: AnyRecord,
		callback: (response: LunaResponse<T>) => void,
	): () => void {
		const child = spawn(
			this.command,
			[...this.getExtraArgs(), '-i', uri, JSON.stringify(params)],
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

	public async* stream<T extends AnyRecord>(
		uri: string,
		params: AnyRecord = { subscribe: true },
	): AsyncGenerator<LunaResponse<T>, void> {
		const sink = new AsyncSink<LunaResponse<T>>();
		const cancel = this.subscribe<T>(uri, params, payload => sink.push(payload));

		try {
			yield* sink;
		} finally {
			cancel();
		}
	}

	private getExtraArgs(): string[] {
		return this.extraArgs.map(arg => typeof arg === 'function' ? arg() : arg);
	}
}
