# fhosts Proxy Helper

This is the native proxy helper required by the fhosts Firefox extension.

## Installation

1. **Create a permanent folder** for the proxy helper, for example:
   ```
   C:\Program Files\fhosts-proxy
   ```

2. **Extract the contents** of this zip into that folder. You should have:
   ```
   C:\Program Files\fhosts-proxy\
   ├── fhosts-proxy.exe
   ├── fhosts_proxy.json
   ├── install.bat
   └── uninstall.bat
   ```

3. **Run `install.bat` as Administrator**
   - Right-click `install.bat` and select "Run as administrator"
   - This registers the proxy helper with Firefox

4. **Restart Firefox** for changes to take effect

## Important

Do not move or delete the proxy folder after installation. The registry points to this location, and the extension will fail if the files are moved.

If you need to move the folder:
1. Run `uninstall.bat` first
2. Move the folder to the new location
3. Run `install.bat` again from the new location

## Uninstallation

1. Run `uninstall.bat` to remove the registry entry
2. Delete the proxy folder
3. The fhosts extension will show a warning that the proxy is not installed
