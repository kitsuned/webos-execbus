# @kitsuned/webos-execbus

Implements [Isomorphic Luna Client](https://github.com/kitsuned/webos-luna-isomorphic-client) for webOS JS Services
using `luna-send`.

It can be used as a drop-in replacement where a regular client would normally be used, without requiring changes to
calling code.

Usage details and behavior of these methods are not redefined here and follow the original library. Refer to its
documentation for specifics.

## Constructor configuration

```typescript
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

	/**
	 * Overrides automatic privilege detection for command selection.
	 * Defaults to current process UID (`uid === 0` means privileged).
	 */
	privileged?: boolean;
};
```

## Why

Under normal conditions, JS services communicate with Luna Bus using
[`palmbus`](https://github.com/webosose/nodejs-module-webos-sysbus), which is usually sufficient. In practice,
however, there is a class of services that are technically reachable but effectively inaccessible.

### Legacy Service ID checks

This behavior originates from early versions of webOS TV (≤ 2), where the security model was primitive. The system
relied on a strict separation between public and private buses, which was not particularly flexible. As a result, some
services implemented their own additional checks on the caller's Service ID to enforce access control.

With the introduction of the unified bus
and [Luna ACG](https://www.webosose.org/docs/guides/development/configuration-files/security-guide/) in later versions,
this kind of manual validation became unnecessary. Access control could now be defined declaratively through roles
assigned to methods.

Despite that, some services still rely on legacy request validation. Even when their methods are marked as public, they
continue to inspect the caller's service ID and apply additional checks internally.

This creates an inconsistent situation: from the bus perspective everything is valid — the method exists and the request
is delivered but the service itself may reject it. For example, if the caller's identifier does not belong to a system
namespace such as `com.palm.*`, `com.webos.*`, or `com.lge.*`, the request is denied. Typical examples include
`com.webos.settingsservice` and `com.webos.notification`, where access is effectively restricted by internal logic
rather than ACG policies.

### Methods with `ares.webos.cli` ACG

There is also a separate class of services that expose methods under `ares.webos.cli` ACG, typically in the `/dev`
category. For example: `com.webos.applicationManager` and `com.webos.appInstallService`.

These methods are not intended for untrusted applications and are not marked as public. Instead, they are designed to
be used from the jailed shell provided by Developer Mode.

Such methods are callable via execbus because luna-send-pub has the `ares.webos.cli` role in addition to `public`.

## What the library does

Instead of calling services directly through the bus, the library uses
[`luna-send`](https://www.webosose.org/docs/tools/commands/luna-send/) as a workaround.

A luna-send child process (or luna-send-pub) is spawned to perform the request. The response is then read from
its stdout and passed back to the caller.

The key detail is that the request is no longer executed under the original client's identity. From the bus perspective,
it comes from the luna-send process itself. There is no visible relationship between the parent process and this client,
and the original Service ID is effectively lost. As a result, the service treats the request as coming from a different,
trusted source.

This is what allows bypassing checks that depend on Service ID.

## Limitations on older systems

On newer systems (webOS TV ≥ 4), this approach works relatively cleanly. luna-send registers itself on the bus with a
unique name (as `com.webos.lunasend[pub]-{pid}`), allowing multiple instances to coexist without conflicts.

On older systems (webOS TV < 4), the situation is more constrained. The built-in role for luna-send does not support
wildcard patterns, which prevents using unique service names. By default, luna-send does not set any Service ID at all,
making it appear as an unidentified client. Requests made in this state are again rejected by services that rely on
identity checks.

The only workaround is to explicitly assign a Service ID using the luna-send `-m` flag. The library can do this
automatically using `preferExplicitServiceId: true`. However, this introduces a significant limitation: service names on
the bus must be unique. As a result, only one such client can exist at a time.

In practice, this means:

- parallel requests will conflict with each other;
- different services using this approach can block one another;
- subscriptions are especially problematic, as they keep the luna-send connected and hold the service name.

This limitation is global and affects the entire system, not just a single application.

## When to use it

This library should only be used if your service needs to call other services that explicitly depend on the caller's
identity and reject requests based on Service ID.

It is particularly relevant when your code runs in a restricted (jailed) environment without elevated privileges. In
such cases, this approach provides a way to work within the existing isolation model without requiring a jailbreak.

In all other situations, you should not use it. If a service works correctly through the standard `palmbus` handle,
there is no benefit in introducing this workaround.

# Credits

Piotr Dobrowolski (aka [@informatic](https://github.com/Informatic)) [introduced](https://github.com/webosbrew/webos-homebrew-channel/commit/00ef2c7e0590061c836449fb09beaf662acfee8c#diff-4af3526582c1235fe0828611e763d56d61a4e8988109050b50c90f3e428f1eee) the execbus technique in [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel).

# License

MIT License

Copyright © 2026 Andrey Smirnov

Made by a human
