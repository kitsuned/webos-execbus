import { readFileSync } from 'fs';

export const majorOsVersion = (() => {
	try {
		// may contain junk on MStar HAL
		const raw = readFileSync('/var/run/nyx/os_info.json', { encoding: 'utf8' });

		// Nyx configs are always flat
		const start = raw.indexOf('{');
		const end = raw.lastIndexOf('}');

		if (start === -1 || end === -1 || end < start) {
			throw new Error('JSON object not found');
		}

		const config: { webos_release: string } = JSON.parse(
			raw.slice(start, end + 1),
		);

		return parseInt(
			config.webos_release.split('.')[0],
		);
	} catch {
		return 1;
	}
})();

export const isLegacyLunaSendRole = majorOsVersion < 4;
