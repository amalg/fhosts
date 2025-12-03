# fhosts

A Firefox extension that overrides DNS resolution for selected domains on a per-tab basis. Think of it as a browser-specific hosts file for local development.

## Features

- Override hostname-to-IP resolution for any domain
- Enable/disable overrides per-tab (test production and local side-by-side)
- Visual indicator shows which tabs have overrides active
- Persists mappings across browser sessions

## Use Case

When developing locally, you often need to test your app with production hostnames (for cookies, CORS, OAuth callbacks, etc.). Instead of editing your system hosts file, fhosts lets you:

1. Map `myapp.com` to `127.0.0.1`
2. Enable the override only in specific tabs
3. Keep other tabs using real DNS

## Installation

### 1. Install the Extension

Install from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/fhosts/) or load temporarily via `about:debugging`.

### 2. Install the Proxy Helper

The extension requires a native proxy helper to perform the actual IP substitution.

1. Download the latest release from [GitHub Releases](https://github.com/amalg/fhosts/releases)
2. Extract the zip file
3. Run `install.bat` (Windows)
4. Restart Firefox

## Usage

1. Click the fhosts icon in the toolbar
2. Add a hostname mapping (e.g., `myapp.com` -> `127.0.0.1`)
3. Toggle "This tab" to enable overrides for the current tab
4. Navigate to your mapped domain

The icon turns cyan when overrides are active for the current tab.

## HTTPS Note

When accessing HTTPS sites through fhosts, you'll see certificate warnings because the certificate won't match the IP you're connecting to. For local development, you can:

- Use a local SSL proxy (like mkcert + local reverse proxy)
- Accept the certificate warning for testing purposes

## Building from Source

### Extension

The extension files can be loaded directly in Firefox via `about:debugging` > "Load Temporary Add-on".

### Proxy Helper

Requires Go 1.21+:

```bash
cd proxy
go build -ldflags="-s -w" -o fhosts-proxy.exe main.go
```

## How It Works

1. The extension uses Firefox's proxy API to intercept requests
2. For mapped hostnames on enabled tabs, requests route through a local proxy (port 8899)
3. The proxy helper connects to the configured IP instead of resolving DNS
4. HTTPS works via CONNECT tunneling with hostname substitution

## Uninstallation

1. Remove the extension from Firefox
2. Run `uninstall.bat` in the proxy folder (removes registry entry)
3. Delete the proxy folder

## License

MIT License - see [LICENSE](LICENSE)
