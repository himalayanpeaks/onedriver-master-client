const state = {
  masterId: "master-01",
  portNumber: 0,
  application: "object",
  processParameterName: "TN_V_SSP_SSC_SP1",
  processParameterDisplay: "MDC - Measurement Value",
  hasDistanceSignal: false,
  currentValue: "--",
  normalizedValue: 0,
  parameters: [],
  commands: [],
  activeVariableTab: "all",
  switchingSignals: {},
  liveSource: null,
  demoTimer: null,
  useDemoMode: true,
};

const elements = {
  connectBtn: document.getElementById("connectBtn"),
  loadSensorBtn: document.getElementById("loadSensorBtn"),
  refreshParamsBtn: document.getElementById("refreshParamsBtn"),
  cloudStatusChip: document.getElementById("cloudStatusChip"),
  sensorStatusChip: document.getElementById("sensorStatusChip"),
  liveStatusChip: document.getElementById("liveStatusChip"),
  cloudMetric: document.getElementById("cloudMetric"),
  sensorMetric: document.getElementById("sensorMetric"),
  modeMetric: document.getElementById("modeMetric"),
  sourceModeLabel: document.getElementById("sourceModeLabel"),
  masterIdLabel: document.getElementById("masterIdLabel"),
  processParameterLabel: document.getElementById("processParameterLabel"),
  currentValueLabel: document.getElementById("currentValueLabel"),
  farDistanceLabel: document.getElementById("farDistanceLabel"),
  nearDistanceLabel: document.getElementById("nearDistanceLabel"),
  switchingSignalLed: document.getElementById("switchingSignalLed"),
  switchingSignalText: document.getElementById("switchingSignalText"),
  apiBaseUrl: document.getElementById("apiBaseUrl"),
  masterIdInput: document.getElementById("masterIdInput"),
  portNumberInput: document.getElementById("portNumberInput"),
  targetObject: document.getElementById("targetObject"),
  tankFill: document.getElementById("tankFill"),
  objectScene: document.getElementById("objectScene"),
  fluidScene: document.getElementById("fluidScene"),
  variableTabButtons: Array.from(document.querySelectorAll(".variable-tab-btn")),
  parameterTableBody: document.getElementById("parameterTableBody"),
  parameterTableTitle: document.getElementById("parameterTableTitle"),
  switchingSignals: document.getElementById("switchingSignals"),
  writeForm: document.getElementById("writeForm"),
  writeName: document.getElementById("writeName"),
  writeValue: document.getElementById("writeValue"),
  activityLog: document.getElementById("activityLog"),
};

const savedBaseUrl = localStorage.getItem("onedriver-webui-api-base-url") || window.location.origin;
elements.apiBaseUrl.value = savedBaseUrl;

const appendLog = (message) => {
  const entry = document.createElement("li");
  entry.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  elements.activityLog.prepend(entry);

  while (elements.activityLog.children.length > 6) {
    elements.activityLog.lastElementChild?.remove();
  }
};

const getApiBaseUrl = () => elements.apiBaseUrl.value.trim().replace(/\/$/, "");

const setApplication = (application) => {
  state.application = application;
  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.application === application);
  });

  elements.objectScene.classList.toggle("active", application === "object");
  elements.fluidScene.classList.toggle("active", application === "fluid");
  elements.modeMetric.textContent = application === "object" ? "Object Detection" : "Fluid Level Measurement";
  updateVisualization(state.normalizedValue);
};

const normalizeValue = (value) => {
  const numeric = Number.parseFloat(value);
  if (Number.isNaN(numeric)) {
    return Math.max(0, Math.min(1, (String(value).length % 25) / 24));
  }

  if (numeric <= 1) {
    return Math.max(0, Math.min(1, numeric));
  }

  if (numeric <= 100) {
    return Math.max(0, Math.min(1, numeric / 100));
  }

  if (numeric <= 4000) {
    return Math.max(0, Math.min(1, numeric / 4000));
  }

  return Math.max(0, Math.min(1, numeric / 10000));
};

const parseNumeric = (value) => {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeWithBounds = (value, minimum, maximum) => {
  const numericValue = parseNumeric(value);
  const min = parseNumeric(minimum);
  const max = parseNumeric(maximum);

  if (numericValue == null || min == null || max == null || max <= min) {
    return normalizeValue(value);
  }

  return Math.max(0, Math.min(1, (numericValue - min) / (max - min)));
};

const toBoolean = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
};

const inferVariableKind = (variable) => {
  const existing = String(variable?.variableKind || "").trim();
  if (existing) {
    return existing;
  }

  const index = Number(variable?.index || 0);
  const haystack = `${variable?.displayName || ""} ${variable?.name || ""}`.toLowerCase();

  if (/command|cmd\b/.test(haystack)) {
    return "Commands";
  }

  if (/specific|vendor|application/.test(haystack) || index >= 0x4000) {
    return "Specific";
  }

  if (/standard|\bstd\b/.test(haystack) || index > 0) {
    return "Standard Params";
  }

  return "Other";
};

const normalizeKindKey = (kind) => {
  const value = String(kind || "").toLowerCase();
  if (value.includes("command")) {
    return "commands";
  }
  if (value.includes("specific")) {
    return "specific";
  }
  if (value.includes("standard")) {
    return "standard";
  }
  return "other";
};

const getDisplayName = (variable) => String(variable?.displayName || "").trim();

const getDisplayLabel = (variable, fallback = "Unnamed parameter") => {
  const displayName = getDisplayName(variable);
  return displayName || fallback;
};

const getAllVariables = () => [...state.parameters, ...state.commands];

const findVariableByName = (name) => {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    return null;
  }

  return getAllVariables().find((variable) => variable.name === normalizedName) || null;
};

const findVariableByInput = (input) => {
  const normalizedInput = String(input || "").trim().toLowerCase();
  if (!normalizedInput) {
    return null;
  }

  return getAllVariables().find((variable) => {
    const displayName = getDisplayName(variable).toLowerCase();
    const internalName = String(variable.name || "").trim().toLowerCase();
    return displayName === normalizedInput || internalName === normalizedInput;
  }) || null;
};

const updateDistanceBounds = (minimum, maximum) => {
  const min = parseNumeric(minimum);
  const max = parseNumeric(maximum);

  elements.farDistanceLabel.textContent = max == null ? "Far" : `Far ${max}`;
  elements.nearDistanceLabel.textContent = min == null ? "Near" : `Near ${min}`;
};

const renderSwitchingSignals = () => {
  const entries = Object.values(state.switchingSignals);
  if (!entries.length) {
    elements.switchingSignals.innerHTML = '<span class="switching-empty">No switching signal yet</span>';
    return;
  }

  elements.switchingSignals.innerHTML = entries.slice(0, 2).map((entry) => `
    <div class="switching-indicator">
      <span class="switching-led ${entry.isOn ? "on" : ""}" aria-hidden="true"></span>
      <span>${entry.label} ${entry.isOn ? "ON" : "OFF"}</span>
    </div>
  `).join("");
};

const updateSwitchingSignal = (name, value, signalId) => {
  const normalizedName = String(name || "Switching signal").trim() || "Switching signal";
  const key = signalId || normalizedName;
  state.switchingSignals[key] = {
    label: normalizedName,
    isOn: toBoolean(value),
  };
  renderSwitchingSignals();
};

const updateVisualization = (normalizedValue) => {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(normalizedValue) ? normalizedValue : 0));
  const objectShift = 40 + clamped * 460;
  const fillHeight = 18 + clamped * 74;

  elements.targetObject.style.setProperty("--object-shift", `${objectShift}px`);
  elements.tankFill.style.setProperty("--fill-height", `${fillHeight}%`);
  elements.currentValueLabel.textContent = state.currentValue;
  elements.processParameterLabel.textContent = state.processParameterDisplay || "--";
};

const setCloudState = (ready, message) => {
  elements.cloudStatusChip.textContent = message;
  elements.cloudMetric.textContent = ready ? "Ready" : "Disconnected";
  elements.cloudMetric.style.color = ready ? "var(--accent)" : "var(--danger)";
};

const setSensorState = (ready, message) => {
  elements.sensorStatusChip.textContent = message;
  elements.sensorMetric.textContent = ready ? "Ready" : "Waiting";
  elements.sensorMetric.style.color = ready ? "var(--accent)" : "var(--danger)";
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const getVisibleVariables = () => {
  const allVariables = [
    ...state.parameters.map((item) => ({ ...item, variableKind: inferVariableKind(item) })),
    ...state.commands.map((item) => ({ ...item, variableKind: "Commands" })),
  ];

  if (state.activeVariableTab === "all") {
    return allVariables;
  }

  return allVariables.filter((variable) => normalizeKindKey(variable.variableKind) === state.activeVariableTab);
};

const renderVariableTabs = () => {
  elements.variableTabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.activeVariableTab);
  });
};

const renderParameters = () => {
  const visibleVariables = getVisibleVariables();

  if (!visibleVariables.length) {
    elements.parameterTableBody.innerHTML = `<tr><td colspan="6" class="empty-state">No parameters returned.</td></tr>`;
    return;
  }

  elements.parameterTableBody.innerHTML = visibleVariables.map((parameter) => `
    <tr data-name="${parameter.name}" data-kind="${parameter.variableKind}">
      <td><strong>${getDisplayLabel(parameter)}</strong></td>
      <td class="value-cell">${parameter.value ?? ""}</td>
      <td>${parameter.dataType || "-"}</td>
      <td>${parameter.index ?? 0}</td>
      <td>${parameter.subindex ?? 0}</td>
      <td>
        <div class="row-actions">
          <button class="row-btn" data-action="read">Read</button>
          <button class="row-btn" data-action="edit">Edit</button>
        </div>
      </td>
    </tr>
  `).join("");
};

const setVariableTab = (tabKey) => {
  state.activeVariableTab = tabKey;
  renderVariableTabs();
  renderParameters();
};

const updateSessionLabels = () => {
  elements.masterIdLabel.textContent = state.masterId;
  elements.masterIdInput.value = state.masterId;
  elements.portNumberInput.value = state.portNumber;
};

const buildDemoParameters = () => [
  { name: "TN_V_SSP_SSC_SP1", displayName: "MDC - Measurement Value", value: "425", dataType: "UINT", index: 256, subindex: 1, minimum: "100", maximum: "1000", variableKind: "Standard Params" },
  { name: "TN_V_RANGE", displayName: "Switching signal 1", value: "1", dataType: "BOOL", index: 257, subindex: 1, variableKind: "Standard Params" },
  { name: "TN_V_LEVEL", displayName: "Switching signal 2", value: "0", dataType: "BOOL", index: 258, subindex: 1, variableKind: "Standard Params" },
  { name: "TN_V_TEMP", displayName: "Vendor specific temp", value: "23.6", dataType: "FLOAT", index: 0x4001, subindex: 1, variableKind: "Specific" },
  { name: "SP1", displayName: "Status word", value: "1", dataType: "BOOL", index: 260, subindex: 1, variableKind: "Other" },
];

const pickProcessParameter = (parameters) => {
  const preferred = parameters.find((parameter) => /distance|range|level|actual|measure|output/i.test(parameter.displayName || parameter.name))
    || parameters.find((parameter) => /int|uint|float|double/i.test(parameter.dataType))
    || parameters[0];

  return preferred?.name || "TN_V_SSP_SSC_SP1";
};

const updateFromParameterValue = ({ parameterName, parameterLabel, value, minimum, maximum }) => {
  if (parameterName) {
    state.processParameterName = parameterName;
  }

  if (parameterLabel) {
    state.processParameterDisplay = parameterLabel;
  } else if (parameterName) {
    const selectedVariable = findVariableByName(parameterName);
    state.processParameterDisplay = getDisplayLabel(selectedVariable, state.processParameterDisplay || "--");
  }

  state.currentValue = value ?? "--";
  state.normalizedValue = normalizeWithBounds(state.currentValue, minimum, maximum);
  updateDistanceBounds(minimum, maximum);
  updateVisualization(state.normalizedValue);
};

const applyProcessSnapshot = (snapshot) => {
  const snapshotParameterName = snapshot.parameterName || state.processParameterName;
  const selectedVariable = findVariableByName(snapshotParameterName);
  const displayName = getDisplayName(snapshot)
    || getDisplayName(selectedVariable)
    || state.processParameterDisplay
    || "--";
  const value = snapshot.value ?? snapshot.rawValue;
  const minimum = snapshot.minimum;
  const maximum = snapshot.maximum;

  if (/mdc\s*-\s*measurement value/i.test(displayName)) {
    state.hasDistanceSignal = true;
    updateFromParameterValue({
      parameterName: snapshotParameterName,
      parameterLabel: displayName,
      value,
      minimum,
      maximum,
    });
    return;
  }

  if (/switching signal/i.test(displayName)) {
    const signalId = snapshot.processDataIndex || `${snapshot.index || "x"}:${snapshot.subindex || "x"}`;
    updateSwitchingSignal(displayName, value, signalId);
    return;
  }

  if (!state.hasDistanceSignal) {
    updateFromParameterValue({
      parameterName: snapshotParameterName,
      parameterLabel: displayName,
      value,
      minimum,
      maximum,
    });
  }
};

const startDemoStream = () => {
  if (state.demoTimer) {
    window.clearInterval(state.demoTimer);
  }

  state.demoTimer = window.setInterval(() => {
    const phase = Date.now() / 1100;
    const distance = 0.5 + 0.5 * Math.sin(phase);
    const simulatedValue = Math.round(1000 * (1 - distance) + 120 * Math.random());
    const switching = simulatedValue < 520 ? "1" : "0";

    applyProcessSnapshot({
      displayName: "MDC - Measurement Value",
      value: String(simulatedValue),
      minimum: "100",
      maximum: "1000",
    });
    applyProcessSnapshot({
      displayName: "SSC - Switching signal 1",
      value: switching,
    });
    applyProcessSnapshot({
      displayName: "SSC - Switching signal 2",
      value: simulatedValue < 300 ? "1" : "0",
    });

    if (state.application === "object") {
      appendLog(`Live object distance ${simulatedValue}`);
    }
  }, 1000);
};

const startLiveStream = () => {
  const apiBaseUrl = getApiBaseUrl();

  if (state.liveSource) {
    state.liveSource.close();
    state.liveSource = null;
  }

  if (!apiBaseUrl) {
    state.useDemoMode = true;
    elements.sourceModeLabel.textContent = "Demo";
    elements.liveStatusChip.textContent = "Live stream demo mode";
    startDemoStream();
    return;
  }

  const query = new URLSearchParams({
    masterId: state.masterId,
    portNumber: String(state.portNumber),
    application: state.application,
    ...(state.processParameterName ? { parameterName: state.processParameterName } : {}),
  });

  const source = new EventSource(`${apiBaseUrl}/api/process/live?${query.toString()}`);
  state.liveSource = source;
  state.useDemoMode = false;
  elements.sourceModeLabel.textContent = "Cloud";
  elements.liveStatusChip.textContent = "Live stream connecting...";

  source.onopen = () => {
    elements.liveStatusChip.textContent = "Live stream running";
    appendLog("Connected to live process stream.");
  };

  source.addEventListener("process", (event) => {
    const snapshot = JSON.parse(event.data);
    applyProcessSnapshot(snapshot);
  });

  source.onerror = () => {
    elements.liveStatusChip.textContent = "Live stream reconnecting...";
  };
};

const connectCloud = async () => {
  state.masterId = elements.masterIdInput.value.trim() || "master-01";
  state.portNumber = Number(elements.portNumberInput.value || 0);
  updateSessionLabels();

  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    setCloudState(false, "Demo mode: no API base URL set");
    appendLog("Running in demo mode. Set the API base URL to connect to the cloud bridge.");
    startLiveStream();
    return;
  }

  try {
    const session = await fetchJson(`${apiBaseUrl}/api/session`, { method: "GET" });
    if (session?.masterId) {
      state.masterId = session.masterId;
      state.portNumber = session.defaultPortNumber ?? state.portNumber;
      updateSessionLabels();
    }

    setCloudState(Boolean(session?.cloudConfigured ?? true), session?.cloudConfigured ? "Cloud bridge ready" : "Cloud bridge connected");
    appendLog("Cloud connection established.");
    startLiveStream();
  } catch (error) {
    setCloudState(false, `Cloud connection failed: ${error.message}`);
    appendLog(`Cloud connection failed: ${error.message}`);
    state.useDemoMode = true;
    startLiveStream();
  }
};

const loadSensor = async () => {
  state.masterId = elements.masterIdInput.value.trim() || "master-01";
  state.portNumber = Number(elements.portNumberInput.value || 0);
  updateSessionLabels();

  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    state.parameters = buildDemoParameters();
    state.commands = [{ name: "CMD_Reset", displayName: "Reset Sensor", value: "", dataType: "COMMAND", index: 2, subindex: 0, variableKind: "Commands" }];
    state.processParameterName = pickProcessParameter(state.parameters);
    renderParameters();
    const processVariable = findVariableByName(state.processParameterName) || state.parameters[0];
    updateFromParameterValue({
      parameterName: processVariable?.name,
      parameterLabel: getDisplayLabel(processVariable),
      value: processVariable?.value,
      minimum: processVariable?.minimum,
      maximum: processVariable?.maximum,
    });
    setSensorState(true, "Demo ultrasonic sensor loaded");
    appendLog("Loaded demo ultrasonic sensor.");
    startLiveStream();
    return;
  }

  try {
    const bootstrap = await fetchJson(`${apiBaseUrl}/api/sensor/bootstrap`, {
      method: "POST",
      body: JSON.stringify({
        masterId: state.masterId,
        portNumber: state.portNumber,
      }),
    });

    state.parameters = (bootstrap.parameters || []).map((parameter) => ({
      ...parameter,
      variableKind: inferVariableKind(parameter),
    }));
    state.commands = (bootstrap.commands || []).map((command) => ({
      ...command,
      variableKind: "Commands",
    }));
    state.processParameterName = bootstrap.suggestedProcessParameter || pickProcessParameter(state.parameters);
    renderParameters();
    const processVariable = findVariableByName(state.processParameterName) || state.parameters[0];
    updateFromParameterValue({
      parameterName: processVariable?.name,
      parameterLabel: getDisplayLabel(processVariable),
      value: processVariable?.value ?? "--",
      minimum: processVariable?.minimum,
      maximum: processVariable?.maximum,
    });
    setSensorState(Boolean(bootstrap.sensorConnected ?? true), `Sensor loaded: ${bootstrap.productName || "Ultrasonic sensor"}`);
    appendLog(`Loaded sensor: ${bootstrap.productName || "Ultrasonic sensor"}`);
    startLiveStream();
  } catch (error) {
    state.parameters = buildDemoParameters();
    state.commands = [{ name: "CMD_Reset", displayName: "Reset Sensor", value: "", dataType: "COMMAND", index: 2, subindex: 0, variableKind: "Commands" }];
    state.processParameterName = pickProcessParameter(state.parameters);
    renderParameters();
    const processVariable = findVariableByName(state.processParameterName) || state.parameters[0];
    updateFromParameterValue({
      parameterName: processVariable?.name,
      parameterLabel: getDisplayLabel(processVariable),
      value: processVariable?.value,
      minimum: processVariable?.minimum,
      maximum: processVariable?.maximum,
    });
    setSensorState(false, `Sensor load fallback: ${error.message}`);
    appendLog(`Sensor load failed, using demo data: ${error.message}`);
    startLiveStream();
  }
};

const refreshParameters = async () => {
  state.masterId = elements.masterIdInput.value.trim() || "master-01";
  state.portNumber = Number(elements.portNumberInput.value || 0);
  updateSessionLabels();

  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    state.parameters = buildDemoParameters();
    renderParameters();
    appendLog(`Demo parameters refreshed: ${state.parameters.length} items`);
    return;
  }

  try {
    const parameters = await fetchJson(`${apiBaseUrl}/api/parameters?portNumber=${state.portNumber}`);
    state.parameters = (parameters || []).map((parameter) => ({
      ...parameter,
      variableKind: inferVariableKind(parameter),
    }));
    renderParameters();
    appendLog(`Parameters refreshed: ${parameters.length} items`);
  } catch (error) {
    appendLog(`Parameter refresh failed: ${error.message}`);
  }
};

elements.connectBtn.addEventListener("click", connectCloud);
elements.loadSensorBtn.addEventListener("click", loadSensor);
elements.refreshParamsBtn.addEventListener("click", refreshParameters);

elements.writeForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const parameterInput = elements.writeName.value.trim();
  const value = elements.writeValue.value.trim();
  const selectedVariable = findVariableByInput(parameterInput);
  const parameterName = selectedVariable?.name || "";
  const parameterLabel = getDisplayLabel(selectedVariable, parameterInput);

  if (!parameterInput || !value) {
    appendLog("Provide a parameter display name and value before writing.");
    return;
  }

  if (!parameterName) {
    appendLog(`Unknown parameter: ${parameterInput}. Use a valid DisplayName from the table.`);
    return;
  }

  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    const row = elements.parameterTableBody.querySelector(`tr[data-name="${CSS.escape(parameterName)}"]`);
    if (row) {
      row.querySelector(".value-cell").textContent = value;
    }

    updateFromParameterValue({ parameterName, parameterLabel, value });
    appendLog(`Demo write ${parameterLabel} = ${value}`);
    elements.writeValue.value = "";
    return;
  }

  try {
    const result = await fetchJson(`${apiBaseUrl}/api/parameters/write`, {
      method: "POST",
      body: JSON.stringify({
        masterId: state.masterId,
        parameterName,
        value,
        portNumber: state.portNumber,
      }),
    });

    const updatedValue = result.parameter?.value ?? value;
    const row = elements.parameterTableBody.querySelector(`tr[data-name="${CSS.escape(parameterName)}"]`);
    if (row) {
      row.querySelector(".value-cell").textContent = updatedValue;
    }

    appendLog(`Wrote ${parameterLabel} = ${updatedValue}`);
    elements.writeValue.value = "";
  } catch (error) {
    appendLog(`Write failed for ${parameterLabel}: ${error.message}`);
  }
});

document.querySelectorAll(".tab-btn").forEach((button) => {
  button.addEventListener("click", () => setApplication(button.dataset.application));
});

elements.variableTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setVariableTab(button.dataset.tab || "all");
  });
});

const initialize = () => {
  state.masterId = elements.masterIdInput.value.trim() || "master-01";
  state.portNumber = Number(elements.portNumberInput.value || 0);
  updateSessionLabels();
  setCloudState(false, savedBaseUrl ? "Cloud bridge waiting" : "Cloud bridge waiting");
  setSensorState(false, "Sensor not loaded");
  updateDistanceBounds(null, null);
  state.switchingSignals = {};
  renderSwitchingSignals();
  setVariableTab("all");
  setApplication("object");
  appendLog("UI initialized.");
  startLiveStream();
};

elements.apiBaseUrl.addEventListener("change", () => {
  localStorage.setItem("onedriver-webui-api-base-url", elements.apiBaseUrl.value.trim());
});

elements.masterIdInput.addEventListener("change", () => {
  state.masterId = elements.masterIdInput.value.trim() || "master-01";
  updateSessionLabels();
});

elements.portNumberInput.addEventListener("change", () => {
  state.portNumber = Number(elements.portNumberInput.value || 0);
});

initialize();
