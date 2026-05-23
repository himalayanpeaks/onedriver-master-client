const state = {
  masterId: "master-01",
  portNumber: 0,
  application: "object",
  processParameter: "",
  processParameterLabel: "Distance MDC",
  currentValue: "--",
  normalizedValue: 0,
  switchingSignals: {
    1: false,
    2: false,
  },
  parameters: [],
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
  switchingSignal1Led: document.getElementById("switchingSignal1Led"),
  switchingSignal1Label: document.getElementById("switchingSignal1Label"),
  switchingSignal2Led: document.getElementById("switchingSignal2Led"),
  switchingSignal2Label: document.getElementById("switchingSignal2Label"),
  apiBaseUrl: document.getElementById("apiBaseUrl"),
  masterIdInput: document.getElementById("masterIdInput"),
  portNumberInput: document.getElementById("portNumberInput"),
  targetObject: document.getElementById("targetObject"),
  tankFill: document.getElementById("tankFill"),
  objectScene: document.getElementById("objectScene"),
  fluidScene: document.getElementById("fluidScene"),
  parameterTableBody: document.getElementById("parameterTableBody"),
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

const DISTANCE_MDC_LABEL = "Distance MDC";

const getSignalHaystack = (candidate) => String([
  candidate?.displayName,
  candidate?.display_name,
  candidate?.parameterName,
  candidate?.name,
].filter(Boolean).join(" ")).toLowerCase();

const isDistanceMdcSignal = (candidate) => {
  const haystack = getSignalHaystack(candidate);
  return /\bmdc\b/.test(haystack)
    && (/measurement\s*value/.test(haystack) || /\bdistance\b/.test(haystack))
    && !/switching\s*signal|\bsp[12]\b|\bssc[12]\b/.test(haystack);
};

const getSwitchingSignalNumber = (candidate) => {
  const haystack = getSignalHaystack(candidate);
  if (/switching\s*signal\s*1|switching\s*signal.*ssc[.\s_-]*1|ssc[.\s_-]*1|\bsp1\b/.test(haystack)) {
    return 1;
  }

  if (/switching\s*signal\s*2|switching\s*signal.*ssc[.\s_-]*2|ssc[.\s_-]*2|\bsp2\b/.test(haystack)) {
    return 2;
  }

  return null;
};

const toBooleanSignal = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "high";
};

const humanizeParameterName = (name) => {
  let normalized = String(name || "").trim();
  if (!normalized) {
    return "Unnamed parameter";
  }

  normalized = normalized.replace(/^TN_V_/, "").replace(/^TN_/, "").replace(/^V_/, "");
  normalized = normalized.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return normalized || "Unnamed parameter";
};

const getParameterDisplayName = (parameter) => {
  const preferred = String(parameter?.display_name ?? parameter?.displayName ?? "").trim();
  if (preferred) {
    return preferred;
  }

  return humanizeParameterName(parameter?.name);
};

const getParameterByInternalName = (name) => state.parameters.find((parameter) => parameter.name === name) || null;

const getParameterLabelFromName = (name) => {
  const parameter = getParameterByInternalName(name);
  if (parameter) {
    return getParameterDisplayName(parameter);
  }

  return humanizeParameterName(name);
};

const resolveParameterName = (input) => {
  const candidate = String(input || "").trim();
  if (!candidate) {
    return "";
  }

  const byInternal = state.parameters.find((parameter) => parameter.name === candidate);
  if (byInternal) {
    return byInternal.name;
  }

  const normalized = candidate.toLowerCase();
  const byDisplay = state.parameters.find(
    (parameter) => getParameterDisplayName(parameter).toLowerCase() === normalized,
  );

  return byDisplay?.name || candidate;
};

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

const updateSwitchingIndicators = () => {
  const signal1Active = Boolean(state.switchingSignals[1]);
  const signal2Active = Boolean(state.switchingSignals[2]);

  elements.switchingSignal1Led.classList.toggle("on", signal1Active);
  elements.switchingSignal2Led.classList.toggle("on", signal2Active);
  elements.switchingSignal1Label.textContent = `Switching Signal 1: ${signal1Active ? "ON" : "OFF"}`;
  elements.switchingSignal2Label.textContent = `Switching Signal 2: ${signal2Active ? "ON" : "OFF"}`;
};

const updateVisualization = (normalizedValue) => {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(normalizedValue) ? normalizedValue : 0));
  const objectShift = 40 + clamped * 460;
  const fillHeight = 18 + clamped * 74;

  elements.targetObject.style.setProperty("--object-shift", `${objectShift}px`);
  elements.tankFill.style.setProperty("--fill-height", `${fillHeight}%`);
  elements.currentValueLabel.textContent = state.currentValue;
  elements.processParameterLabel.textContent = state.processParameterLabel || getParameterLabelFromName(state.processParameter);
  updateSwitchingIndicators();
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

const renderParameters = (parameters) => {
  if (!parameters.length) {
    elements.parameterTableBody.innerHTML = `<tr><td colspan="6" class="empty-state">No parameters returned.</td></tr>`;
    return;
  }

  elements.parameterTableBody.innerHTML = parameters.map((parameter) => `
    <tr data-name="${parameter.name}">
      <td><strong>${getParameterDisplayName(parameter)}</strong></td>
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

const updateSessionLabels = () => {
  elements.masterIdLabel.textContent = state.masterId;
  elements.masterIdInput.value = state.masterId;
  elements.portNumberInput.value = state.portNumber;
};

const buildDemoParameters = () => [
  { name: "DISTANCE_MDC", display_name: DISTANCE_MDC_LABEL, value: "425", dataType: "UINT", index: 256, subindex: 1 },
  { name: "TN_V_RANGE", display_name: "Detection Range", value: "950", dataType: "UINT", index: 257, subindex: 1 },
  { name: "TN_V_LEVEL", display_name: "Fluid Level", value: "72", dataType: "UINT", index: 258, subindex: 1 },
  { name: "TN_V_TEMP", display_name: "Sensor Temperature", value: "23.6", dataType: "FLOAT", index: 259, subindex: 1 },
  { name: "SP1", display_name: "Switching Signal 1", value: "1", dataType: "BOOL", index: 260, subindex: 1 },
  { name: "SP2", display_name: "Switching Signal 2", value: "0", dataType: "BOOL", index: 260, subindex: 2 },
];

const pickProcessParameter = (parameters) => {
  const preferred = parameters.find((parameter) => isDistanceMdcSignal(parameter))
    || parameters.find((parameter) => {
    const haystack = `${getParameterDisplayName(parameter)} ${parameter.name || ""}`;
    return /distance|range|level|actual|measure|measurement|output/i.test(haystack);
  })
    || parameters.find((parameter) => /int|uint|float|double/i.test(parameter.dataType))
    || parameters[0];

  return preferred?.name || "DISTANCE_MDC";
};

const updateFromParameterValue = (parameterName, value, label = "") => {
  state.processParameter = parameterName || state.processParameter;
  state.processParameterLabel = label || getParameterLabelFromName(parameterName) || state.processParameterLabel || DISTANCE_MDC_LABEL;
  state.currentValue = value ?? "--";
  state.normalizedValue = normalizeValue(state.currentValue);
  updateVisualization(state.normalizedValue);
};

const updateSwitchingSignal = (signalNumber, value) => {
  if (!signalNumber || !(signalNumber in state.switchingSignals)) {
    return;
  }

  state.switchingSignals[signalNumber] = toBooleanSignal(value);
  updateSwitchingIndicators();
};

const updateFromProcessSnapshot = (snapshot) => {
  const signalNumber = getSwitchingSignalNumber(snapshot);
  if (signalNumber) {
    updateSwitchingSignal(signalNumber, snapshot.value ?? snapshot.rawValue);
    return;
  }

  if (!isDistanceMdcSignal(snapshot)) {
    return;
  }

  updateFromParameterValue(
    snapshot.parameterName || state.processParameter,
    snapshot.rawValue ?? snapshot.value,
    DISTANCE_MDC_LABEL,
  );
};

const startDemoStream = () => {
  if (state.demoTimer) {
    window.clearInterval(state.demoTimer);
  }

  state.demoTimer = window.setInterval(() => {
    const phase = Date.now() / 1100;
    const distance = 0.5 + 0.5 * Math.sin(phase);
    const simulatedValue = Math.round(1000 * (1 - distance) + 120 * Math.random());

    updateFromParameterValue(state.processParameter || "DISTANCE_MDC", String(simulatedValue), DISTANCE_MDC_LABEL);
    updateSwitchingSignal(1, simulatedValue < 450);
    updateSwitchingSignal(2, simulatedValue < 225);

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
    ...(state.processParameter ? { parameterName: state.processParameter } : {}),
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
    updateFromProcessSnapshot(snapshot);
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
    state.processParameter = pickProcessParameter(state.parameters);
    renderParameters(state.parameters);
    updateFromParameterValue(state.processParameter, state.parameters[0].value, DISTANCE_MDC_LABEL);
    updateSwitchingSignal(1, state.parameters.find((parameter) => parameter.name === "SP1")?.value);
    updateSwitchingSignal(2, state.parameters.find((parameter) => parameter.name === "SP2")?.value);
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

    state.parameters = bootstrap.parameters || [];
    state.processParameter = bootstrap.suggestedProcessParameter || pickProcessParameter(state.parameters);
    renderParameters(state.parameters);
    updateFromParameterValue(
      state.processParameter,
      getParameterByInternalName(state.processParameter)?.value ?? bootstrap.parameters?.[0]?.value ?? "--",
      state.processParameterLabel,
    );
    setSensorState(Boolean(bootstrap.sensorConnected ?? true), `Sensor loaded: ${bootstrap.productName || "Ultrasonic sensor"}`);
    appendLog(`Loaded sensor: ${bootstrap.productName || "Ultrasonic sensor"}`);
    startLiveStream();
  } catch (error) {
    state.parameters = buildDemoParameters();
    state.processParameter = pickProcessParameter(state.parameters);
    renderParameters(state.parameters);
    updateFromParameterValue(state.processParameter, state.parameters[0].value, DISTANCE_MDC_LABEL);
    updateSwitchingSignal(1, state.parameters.find((parameter) => parameter.name === "SP1")?.value);
    updateSwitchingSignal(2, state.parameters.find((parameter) => parameter.name === "SP2")?.value);
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
    renderParameters(state.parameters);
    appendLog(`Demo parameters refreshed: ${state.parameters.length} items`);
    return;
  }

  try {
    const parameters = await fetchJson(`${apiBaseUrl}/api/parameters?portNumber=${state.portNumber}`);
    state.parameters = parameters;
    renderParameters(parameters);
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

  const parameterNameInput = elements.writeName.value.trim();
  const value = elements.writeValue.value.trim();

  if (!parameterNameInput || !value) {
    appendLog("Provide a parameter name and value before writing.");
    return;
  }

  const parameterName = resolveParameterName(parameterNameInput);
  const parameterLabel = getParameterLabelFromName(parameterName);

  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    const row = elements.parameterTableBody.querySelector(`tr[data-name="${CSS.escape(parameterName)}"]`);
    if (row) {
      row.querySelector(".value-cell").textContent = value;
    }

    updateFromParameterValue(parameterName, value);
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

const initialize = () => {
  state.masterId = elements.masterIdInput.value.trim() || "master-01";
  state.portNumber = Number(elements.portNumberInput.value || 0);
  updateSessionLabels();
  setCloudState(false, savedBaseUrl ? "Cloud bridge waiting" : "Cloud bridge waiting");
  setSensorState(false, "Sensor not loaded");
  renderParameters([]);
  setApplication("object");
  updateSwitchingIndicators();
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
