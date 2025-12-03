// fhosts popup script - per-tab mode

const tabToggle = document.getElementById('tabToggle');
const tabStatusText = document.getElementById('tabStatusText');
const enabledTabCount = document.getElementById('enabledTabCount');
const hostnameInput = document.getElementById('hostnameInput');
const ipInput = document.getElementById('ipInput');
const addBtn = document.getElementById('addBtn');
const mappingsContainer = document.getElementById('mappingsContainer');
const proxyStatus = document.getElementById('proxyStatus');

let currentTabId = null;

// Get the current tab
async function getCurrentTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

// Load current settings
async function loadSettings() {
  const tab = await getCurrentTab();
  currentTabId = tab.id;

  const response = await browser.runtime.sendMessage({
    action: 'getSettings',
    tabId: currentTabId
  });

  tabToggle.checked = response.isTabEnabled;
  updateTabStatusText(response.isTabEnabled);
  updateEnabledTabCount(response.enabledTabCount);
  updateProxyStatus(response.proxyError);
  renderMappings(response.hostMappings);
}

// Update proxy status warning visibility
function updateProxyStatus(hasError) {
  // Only show warning if there was an actual connection error
  proxyStatus.style.display = hasError ? 'block' : 'none';
}

// Update the tab status text
function updateTabStatusText(isEnabled) {
  tabStatusText.textContent = isEnabled ? 'This tab: ON' : 'This tab: OFF';
  tabStatusText.className = isEnabled ? 'status-on' : 'status-off';
}

// Update the enabled tab count display
function updateEnabledTabCount(count) {
  enabledTabCount.textContent = count === 1 ? '1 tab active' : `${count} tabs active`;
}

// Create a mapping item element
function createMappingItem(hostname, config) {
  const item = document.createElement('div');
  item.className = `mapping-item ${config.enabled ? '' : 'disabled'}`;

  const info = document.createElement('div');
  info.className = 'mapping-info';

  const toggle = document.createElement('label');
  toggle.className = 'mapping-toggle';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'mapping-enabled';
  checkbox.dataset.hostname = hostname;
  checkbox.checked = config.enabled;
  checkbox.addEventListener('change', handleToggleMapping);

  const slider = document.createElement('span');
  slider.className = 'slider-small';

  toggle.appendChild(checkbox);
  toggle.appendChild(slider);

  const details = document.createElement('div');
  details.className = 'mapping-details';

  const hostnameSpan = document.createElement('span');
  hostnameSpan.className = 'hostname';
  hostnameSpan.textContent = hostname;

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '->';

  const ipSpan = document.createElement('span');
  ipSpan.className = 'ip';
  ipSpan.textContent = config.ip;

  details.appendChild(hostnameSpan);
  details.appendChild(arrow);
  details.appendChild(ipSpan);

  info.appendChild(toggle);
  info.appendChild(details);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-icon btn-delete';
  deleteBtn.dataset.hostname = hostname;
  deleteBtn.title = 'Remove';
  deleteBtn.textContent = 'X';
  deleteBtn.addEventListener('click', handleDeleteMapping);

  item.appendChild(info);
  item.appendChild(deleteBtn);

  return item;
}

// Render the mappings list
function renderMappings(mappings) {
  const entries = Object.entries(mappings);

  // Clear container
  mappingsContainer.replaceChildren();

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No host overrides configured';
    mappingsContainer.appendChild(empty);
    return;
  }

  entries.forEach(([hostname, config]) => {
    mappingsContainer.appendChild(createMappingItem(hostname, config));
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Validate hostname
function isValidHostname(hostname) {
  const pattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
  return pattern.test(hostname) && hostname.length <= 253;
}

// Validate IP address
function isValidIp(ip) {
  // IPv4 validation
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(ip)) {
    const parts = ip.split('.').map(Number);
    return parts.every(part => part >= 0 && part <= 255);
  }

  // IPv6 validation (simplified)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  if (ipv6Pattern.test(ip)) {
    return true;
  }

  // Also allow "localhost"
  if (ip === 'localhost') {
    return true;
  }

  return false;
}

// Handle toggling the current tab
async function handleToggleTab() {
  const wantEnabled = tabToggle.checked;

  // Show loading state while connecting
  if (wantEnabled) {
    tabStatusText.textContent = 'Connecting...';
    tabStatusText.className = '';
  }

  const response = await browser.runtime.sendMessage({
    action: 'toggleTab',
    tabId: currentTabId,
    enabled: wantEnabled
  });

  if (!response.success) {
    // Failed to enable - revert toggle and show warning
    tabToggle.checked = false;
    updateTabStatusText(false);
    proxyStatus.style.display = 'block';
  } else {
    updateTabStatusText(response.isTabEnabled);
    proxyStatus.style.display = 'none';
  }

  loadSettings();
}

// Handle adding a new mapping
async function handleAddMapping() {
  const hostname = hostnameInput.value.trim().toLowerCase();
  const ip = ipInput.value.trim();

  // Validation
  if (!hostname) {
    showError('Please enter a hostname');
    hostnameInput.focus();
    return;
  }

  if (!isValidHostname(hostname)) {
    showError('Invalid hostname format');
    hostnameInput.focus();
    return;
  }

  if (!ip) {
    showError('Please enter an IP address');
    ipInput.focus();
    return;
  }

  if (!isValidIp(ip)) {
    showError('Invalid IP address');
    ipInput.focus();
    return;
  }

  await browser.runtime.sendMessage({
    action: 'addMapping',
    hostname,
    ip
  });

  // Clear inputs
  hostnameInput.value = '';
  ipInput.value = '';

  loadSettings();
}

// Handle toggling a mapping
async function handleToggleMapping(event) {
  const hostname = event.target.dataset.hostname;
  const enabled = event.target.checked;

  await browser.runtime.sendMessage({
    action: 'toggleMapping',
    hostname,
    enabled
  });

  loadSettings();
}

// Handle deleting a mapping
async function handleDeleteMapping(event) {
  const hostname = event.target.dataset.hostname;

  await browser.runtime.sendMessage({
    action: 'removeMapping',
    hostname
  });

  loadSettings();
}

// Show error message
function showError(message) {
  const existingError = document.querySelector('.error-message');
  if (existingError) {
    existingError.remove();
  }

  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;

  const addSection = document.querySelector('.add-mapping');
  addSection.insertBefore(errorDiv, addBtn);

  setTimeout(() => {
    errorDiv.remove();
  }, 3000);
}

// Event listeners
tabToggle.addEventListener('change', handleToggleTab);
addBtn.addEventListener('click', handleAddMapping);

// Allow Enter key to submit
hostnameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') ipInput.focus();
});
ipInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleAddMapping();
});

// Check proxy availability on popup open
async function checkProxyAvailability() {
  const response = await browser.runtime.sendMessage({ action: 'checkProxy' });
  if (!response.available) {
    proxyStatus.style.display = 'block';
    tabToggle.disabled = true;
  } else {
    proxyStatus.style.display = 'none';
    tabToggle.disabled = false;
  }
}

// Initial load
checkProxyAvailability();
loadSettings();
