// fhosts - Firefox extension for per-browser host overrides
// Uses a local proxy helper for actual DNS override
// Supports per-tab enable/disable

const PROXY_PORT = 8899;
const NATIVE_HOST = 'fhosts_proxy';

let hostMappings = {};
let enabledTabs = new Set();
let nativePort = null;
let proxyReady = false;
let proxyError = false;
let proxyConnecting = false;

// Load settings from storage
async function loadSettings() {
  try {
    const result = await browser.storage.local.get(['hostMappings']);
    hostMappings = result.hostMappings || {};
  } catch (error) {
    console.error('fhosts: Error loading settings:', error);
  }
}

// Save settings to storage
async function saveSettings() {
  try {
    await browser.storage.local.set({ hostMappings });
  } catch (error) {
    console.error('fhosts: Error saving settings:', error);
  }
}

// Get active host mappings (only enabled ones)
function getActiveMappings() {
  const active = {};
  for (const [hostname, config] of Object.entries(hostMappings)) {
    if (config.enabled) {
      active[hostname] = config.ip;
    }
  }
  return active;
}

// Connect to native messaging host - returns a promise that resolves when connected or rejects on failure
function connectToProxy() {
  return new Promise((resolve, reject) => {
    if (nativePort && proxyReady) {
      resolve(true);
      return;
    }

    // If already connecting, wait for result
    if (nativePort && proxyConnecting) {
      const checkInterval = setInterval(() => {
        if (proxyReady) {
          clearInterval(checkInterval);
          resolve(true);
        } else if (proxyError) {
          clearInterval(checkInterval);
          reject(new Error('Proxy connection failed'));
        }
      }, 50);
      // Timeout after 3 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!proxyReady) {
          reject(new Error('Proxy connection timeout'));
        }
      }, 3000);
      return;
    }

    proxyError = false;
    proxyConnecting = true;

    try {
      nativePort = browser.runtime.connectNative(NATIVE_HOST);

      nativePort.onMessage.addListener((message) => {
        console.log('fhosts: Proxy message:', message);

        if (message.type === 'ready') {
          // Proxy is ready, send start command with mappings
          proxyError = false;
          nativePort.postMessage({
            action: 'start',
            mappings: getActiveMappings()
          });
        } else if (message.type === 'started') {
          proxyReady = true;
          proxyError = false;
          proxyConnecting = false;
          console.log(`fhosts: Proxy started on port ${message.port}`);
          resolve(true);
        } else if (message.type === 'stopped') {
          proxyReady = false;
        } else if (message.type === 'error') {
          console.error('fhosts: Proxy error:', message.message);
          proxyError = true;
          proxyConnecting = false;
          reject(new Error(message.message || 'Proxy error'));
        }
      });

      nativePort.onDisconnect.addListener(() => {
        console.log('fhosts: Native port disconnected');
        if (browser.runtime.lastError) {
          console.error('fhosts: Disconnect error:', browser.runtime.lastError.message);
        }
        // If we were connecting or thought we were ready, this is an error
        if (proxyConnecting || proxyReady) {
          proxyError = true;
          proxyConnecting = false;
          reject(new Error('Native host not available'));
        }
        nativePort = null;
        proxyReady = false;
        proxyConnecting = false;
      });

    } catch (error) {
      console.error('fhosts: Failed to connect to native host:', error);
      nativePort = null;
      proxyError = true;
      proxyConnecting = false;
      reject(error);
    }
  });
}

// Disconnect from native messaging host
function disconnectFromProxy() {
  if (nativePort) {
    try {
      nativePort.postMessage({ action: 'stop' });
    } catch (e) {
      // Ignore errors when stopping
    }
    nativePort.disconnect();
    nativePort = null;
    proxyReady = false;
    console.log('fhosts: Proxy stopped');
  }
}

// Update proxy with current mappings
function updateProxyMappings() {
  if (nativePort && proxyReady) {
    nativePort.postMessage({
      action: 'updateMappings',
      mappings: getActiveMappings()
    });
  }
}

// Update the extension icon for a specific tab
function updateTabIcon(tabId) {
  const isEnabled = enabledTabs.has(tabId);
  const iconPath = isEnabled ? 'icons/icon.svg' : 'icons/icon-disabled.svg';

  browser.action.setIcon({ path: iconPath, tabId }).catch(() => {});
}

// Proxy request handler - route enabled tabs through local proxy
function handleProxyRequest(requestInfo) {
  const tabId = requestInfo.tabId;

  // Not an enabled tab - go direct
  if (tabId === -1 || !enabledTabs.has(tabId)) {
    return { type: 'direct' };
  }

  const url = new URL(requestInfo.url);
  const hostname = url.hostname;

  // Check if we have a mapping for this hostname
  const mapping = hostMappings[hostname];
  if (mapping && mapping.enabled) {
    // If proxy isn't ready, block the request to prevent confusion
    // This will show a connection error instead of the real site
    if (!proxyReady) {
      console.log(`fhosts: [Tab ${tabId}] Blocking ${hostname} - proxy not ready`);
      // Return an invalid proxy to cause a clear connection failure
      return {
        type: 'http',
        host: '127.0.0.1',
        port: 1  // Invalid port - will fail to connect
      };
    }

    console.log(`fhosts: [Tab ${tabId}] Routing ${hostname} through local proxy`);

    // Route through our local proxy which will handle the IP substitution
    return {
      type: 'http',
      host: '127.0.0.1',
      port: PROXY_PORT
    };
  }

  return { type: 'direct' };
}

// Handle errors in proxy resolution
function handleProxyError(error) {
  console.error('fhosts: Proxy error:', error.message);
}

// Clean up when a tab is closed
browser.tabs.onRemoved.addListener((tabId) => {
  const wasEnabled = enabledTabs.has(tabId);
  enabledTabs.delete(tabId);

  // If no more enabled tabs, stop the proxy
  if (wasEnabled && enabledTabs.size === 0) {
    disconnectFromProxy();
  }
});

// Inherit enabled state when a new tab is opened from an enabled tab
browser.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId !== undefined && enabledTabs.has(tab.openerTabId)) {
    console.log(`fhosts: Tab ${tab.id} inheriting enabled state from opener tab ${tab.openerTabId}`);
    enabledTabs.add(tab.id);
    updateTabIcon(tab.id);
  }
});

// Re-apply icon state when tabs reload (Firefox resets to default on navigation)
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updateTabIcon(tabId);
  }
});

// Message handler for communication with popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'getSettings':
      sendResponse({
        hostMappings,
        isTabEnabled: message.tabId ? enabledTabs.has(message.tabId) : false,
        enabledTabCount: enabledTabs.size,
        proxyReady,
        proxyError,
        proxyConnecting
      });
      break;

    case 'checkProxy':
      // Try to connect to proxy and return status
      connectToProxy()
        .then(() => {
          sendResponse({ available: true });
        })
        .catch(() => {
          sendResponse({ available: false });
        });
      return true; // Keep message channel open for async response

    case 'toggleTab':
      if (message.enabled) {
        // First tab being enabled - start proxy and wait for connection
        const needsConnect = enabledTabs.size === 0;
        if (needsConnect) {
          connectToProxy()
            .then(() => {
              enabledTabs.add(message.tabId);
              updateTabIcon(message.tabId);
              sendResponse({ success: true, isTabEnabled: true });
            })
            .catch((error) => {
              console.error('fhosts: Failed to enable - proxy not available:', error.message);
              updateTabIcon(message.tabId);
              sendResponse({ success: false, isTabEnabled: false, error: 'Proxy helper not installed or not running' });
            });
        } else {
          // Proxy already running, just add the tab
          enabledTabs.add(message.tabId);
          updateTabIcon(message.tabId);
          sendResponse({ success: true, isTabEnabled: true });
        }
      } else {
        enabledTabs.delete(message.tabId);
        // Last tab disabled - stop proxy
        if (enabledTabs.size === 0) {
          disconnectFromProxy();
        }
        updateTabIcon(message.tabId);
        sendResponse({ success: true, isTabEnabled: false });
      }
      return true; // Keep message channel open for async response

    case 'addMapping':
      hostMappings[message.hostname] = {
        ip: message.ip,
        enabled: true
      };
      saveSettings();
      updateProxyMappings();
      sendResponse({ success: true });
      break;

    case 'removeMapping':
      delete hostMappings[message.hostname];
      saveSettings();
      updateProxyMappings();
      sendResponse({ success: true });
      break;

    case 'toggleMapping':
      if (hostMappings[message.hostname]) {
        hostMappings[message.hostname].enabled = message.enabled;
        saveSettings();
        updateProxyMappings();
      }
      sendResponse({ success: true });
      break;

    case 'updateMapping':
      if (hostMappings[message.hostname]) {
        hostMappings[message.hostname].ip = message.ip;
        saveSettings();
        updateProxyMappings();
      }
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ error: 'Unknown action' });
  }
  return true;
});

// Initialize
loadSettings().then(() => {
  // Register the proxy handler
  browser.proxy.onRequest.addListener(
    handleProxyRequest,
    { urls: ['<all_urls>'] }
  );

  browser.proxy.onError.addListener(handleProxyError);

  console.log('fhosts: Extension initialized (with native proxy support)');
});
