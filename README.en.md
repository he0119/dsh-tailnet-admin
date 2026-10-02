# dsh-tailnet-admin

<img src="assets/icon.svg" alt="dsh-tailnet-admin" width="88" height="88">

Treat Tailnet / reverse-proxy pages as local: make DSH's settings pages work from a non-loopback origin, and
optionally drop the browser session check (the Host/Origin fence stays).

> ⚠️ This plugin touches an authentication boundary: **both switches default to off**, so installing it changes
> nothing. Read [Security boundary](#security-boundary-read-this) before enabling the second one.

## What it fixes

Opening DSH from `https://dsh.example.ts.net` (any Tailnet service name or reverse-proxy hostname) runs into two
independent problems:

**① Settings pages are unusable**: the model/provider directory, credentials and the config-file editor report
`settings are unavailable in this browser`. DSH's browser half only treats two cases as "local" — the
`globalThis.__DSH_TRANSPORT__ = { ownsHost: true }` flag injected by the desktop shell, or a page whose
`location.hostname` is loopback (`localhost` / `127.0.0.0/8` / `[::1]`). A page served from a domain satisfies
neither, so settings fall back to process-local persistence and report themselves unavailable. **That decision
lives in the browser half; the server-side `--trusted-host` cannot influence it.**

**② Every restart asks for a token again**: the host judges `/api` with two layers — a Host/Origin fence plus a
browser-session check. The latter wants a cookie minted from `?token=`, bound to the request authority; the token
is regenerated on each start, and the cookie stops matching as soon as the authority changes.

The plugin splits those into two independent switches: `pageHosts` for ①, `disableBrowserAuth` for ②. Rationale and
cost live in [.agents/notes/implemented/](.agents/notes/implemented) (Chinese).

## Install

Requires Node `^22.19.0 || >=24.0.0` (same range as official DSH).

### 1. Add the package

```sh
npx @deepseek-ai/dsh plugin --profile web add @he0119/dsh-tailnet-admin
```

The published tarball ships a compiled `lib/`, so no build script has to be approved. For local development,
install the repository directory instead (after `pnpm run build`):

```sh
npx @deepseek-ai/dsh plugin --profile web add link:/path/to/dsh-tailnet-admin
```

### 2. Register it as a bundle

`dsh plugin add` only runs `pnpm add`. At startup DSH reads **only** `dsh.profile.bundles`, so add the package name
there:

```json
// ~/.dsh/profiles/web/package.json
"dsh": {
  "profile": {
    "bundles": [
      // …
      "@he0119/dsh-tailnet-admin"
    ]
  }
}
```

The GUI does the same thing: **Settings → Plugins** lists packages that are installed but not enabled yet, and
enabling one edits exactly that array.

Restart DSH afterwards (`systemctl --user restart dsh-web` for a systemd deployment). The startup log will show
the `[dsh-tailnet-admin] …` lines when it is in place.

### 3. Turn the switches on

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: tailnet-admin
  name: '@he0119/dsh-tailnet-admin'
  config:
    pageHosts:
      - .ts.net              # an exact hostname works too, as does `*`
    disableBrowserAuth: true # default false; read "Security boundary" first
```

## Switches

| Switch | Environment variable | Default | Effect |
| --- | --- | --- | --- |
| `pageHosts` | `DSH_TAILNET_ADMIN_PAGE_HOSTS` | `[]` | Which page hosts count as local. A leading `.` means suffix match (`.ts.net` matches `a.ts.net`, not bare `ts.net`); `*` matches everything |
| `disableBrowserAuth` | `DSH_TAILNET_ADMIN_DISABLE_AUTH` | `false` | Whether to drop the browser session check (token/cookie) |

- **Environment variables win over config.** Both are supported: environment variables suit an ops-owned place
  such as a systemd unit, config travels with the profile.
- The environment host list is **comma separated**; an empty string clears it explicitly (overriding config).
- Booleans accept **only** `1` / `true` / `on` / `yes` (case-insensitive). Anything else counts as off — the
  reverse rule would turn a typo into "authentication disabled".

A systemd example:

```ini
[Service]
Environment=DSH_TAILNET_ADMIN_PAGE_HOSTS=.ts.net
Environment=DSH_TAILNET_ADMIN_DISABLE_AUTH=1
ExecStart=%h/.npm/_npx/<hash>/node_modules/.bin/dsh web --host 127.0.0.1 --port 3080 \
  --trusted-host dsh.example.ts.net --no-open
```

> `--trusted-host` (or the connection plugin's `trustedHosts`) is a **separate** requirement: the `/api`
> Host/Origin fence only accepts loopback or a declared authority. Turning on this plugin's switches without it
> still ends in a 403 at the fence.

## Security boundary (read this)

`disableBrowserAuth: true` removes the "who may enter this UI" check. Once it is on:

- **Anyone who can open the page** gains control of the machine — read and write files, run commands, use the API
  keys you configured in DSH. Exposure follows your Tailscale ACLs / reverse-proxy access rules, **not the token**.
- What remains is the **Host/Origin fence**: loopback or a declared authority, plus a rejection of
  `Sec-Fetch-Site: cross-site`. It stops DNS rebinding and cross-site requests; it does **not** stop someone who
  simply knows the address.
- `pageHosts`, by contrast, only affects **browser-side** settings persistence and UI availability. It changes no
  server-side decision.

Suggested posture: enable `pageHosts` as needed, enable `disableBrowserAuth` only when the token really keeps
interrupting you, and double-check that your Tailscale ACLs only admit your own devices. To revert, drop the
environment variable (or set config back to `false`) and restart — there is no state to clean up.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Still `settings are unavailable in this browser` | `pageHosts` does not match the current page host (suffix rules need the dot: `.ts.net`), or DSH was not restarted |
| Requests fail with 403 | The Host/Origin fence rejected them: add `--trusted-host <authority>` to `dsh web` |
| Still asked for `?token=` | `disableBrowserAuth` is off, or the environment value is something unrecognized such as `ture` (only `1`/`true`/`on`/`yes` count) |
| No `[dsh-tailnet-admin]` line in the startup log | The name is missing from `dsh.profile.bundles`, or the package is not installed (check with `dsh --profile web --dump-config \| grep tailnet-admin`) |
| A config value has no effect | An environment variable of the same name is present, and it wins |

## Development

[docs/development.md](docs/development.md) covers building, testing and the manual "install into a dedicated
profile and look at the page" path; [docs/internals.md](docs/internals.md) explains why the implementation looks
the way it does; [docs/releasing.md](docs/releasing.md) covers releases (including why the first version must be
published by hand).

```sh
pnpm install     # also runs prepare, i.e. a full build
pnpm test        # unit tests (offline)
pnpm run typecheck
pnpm run build
```

## License

[MIT](LICENSE)
