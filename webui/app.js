const state = {
  masterId: "master-01",
  portNumber: 0,
  application: "object",
  processParameter: "",
  processParameterLabel: "Distance MDC",
  currentValue: "--",
  normalizedValue: 0,
  processMinimum: null,
  processMaximum: null,
  switchingSignals: {
    1: false,
    2: false,
  },
  parameters: [],
  parameterNames: [],
  activeParameterKind: "All",
  liveSource: null,
  demoTimer: null,
  connectInFlight: false,
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
  nearDistanceLabel: document.getElementById("nearDistanceLabel"),
  farDistanceLabel: document.getElementById("farDistanceLabel"),
  objectScene: document.getElementById("objectScene"),
  fluidScene: document.getElementById("fluidScene"),
  parameterKindTabs: document.getElementById("parameterKindTabs"),
  parameterTableBody: document.getElementById("parameterTableBody"),
  writeForm: document.getElementById("writeForm"),
  readParameterBtn: document.getElementById("readParameterBtn"),
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
const DEFAULT_PARAMETER_KIND = "All";
const PARAMETER_KIND_ORDER = [
  "Standard Params",
  "Specific",
  "System",
  "Commands",
  "Events",
  "PdIn",
  "PdOut",
  "Process Data",
  "Other",
];

const parseFiniteNumber = (value) => {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
};

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

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#39;");

const renderParameterValueCell = (parameter) => {
  if (parameter?.value === null || parameter?.value === undefined) {
    return '<span class="value-empty">n/a</span>';
  }

  if (typeof parameter.value === "string" && parameter.value.length === 0) {
    return '<span class="value-empty">(empty)</span>';
  }

  return escapeHtml(parameter.value);
};

const updateParameterInState = (parameterName, updater) => {
  const index = state.parameters.findIndex((parameter) => parameter.name === parameterName);
  if (index < 0) {
    return;
  }

  const current = state.parameters[index];
  state.parameters[index] = {
    ...current,
    ...updater(current),
  };
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

  const min = parseFiniteNumber(state.processMinimum);
  const max = parseFiniteNumber(state.processMaximum);
  if (min !== null && max !== null && max > min) {
    return Math.max(0, Math.min(1, (numeric - min) / (max - min)));
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

const formatRangeValue = (value) => {
  const numeric = parseFiniteNumber(value);
  if (numeric === null) {
    return "--";
  }

  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
};

const updateDistanceRangeLabels = () => {
  if (elements.nearDistanceLabel) {
    elements.nearDistanceLabel.textContent = `Near ${formatRangeValue(state.processMinimum)}`;
  }

  if (elements.farDistanceLabel) {
    elements.farDistanceLabel.textContent = `Far ${formatRangeValue(state.processMaximum)}`;
  }
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
  updateDistanceRangeLabels();
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

const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const fetchJson = async (url, options = {}) => {
  const { timeoutMs = 6000, ...requestOptions } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(requestOptions.headers || {}),
      },
      ...requestOptions,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const fetchJsonWithRetry = async (url, options = {}, retryOptions = {}) => {
  const attempts = Math.max(1, Number(retryOptions.attempts || 2));
  const retryDelayMs = Math.max(100, Number(retryOptions.retryDelayMs || 250));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await wait(retryDelayMs * attempt);
      }
    }
  }

  throw lastError || new Error("Request failed.");
};

const normalizeVariableKind = (parameter) => {
  const rawKind = String(parameter?.variableKind || "").trim();
  const normalized = rawKind.toLowerCase();
  if (!normalized) {
    return "Other";
  }

  if (/^standard|\bstd\b/.test(normalized)) {
    return "Standard Params";
  }

  if (/^specific|vendor|application/.test(normalized)) {
    return "Specific";
  }

  if (/^system/.test(normalized)) {
    return "System";
  }

  if (/^command/.test(normalized)) {
    return "Commands";
  }

  if (/^event/.test(normalized)) {
    return "Events";
  }

  if (/^pd\s*in|^pdin|process\s*data\s*in|process\s*input/.test(normalized)) {
    return "PdIn";
  }

  if (/^pd\s*out|^pdout|process\s*data\s*out|process\s*output/.test(normalized)) {
    return "PdOut";
  }

  if (/^process/.test(normalized)) {
    return "Process Data";
  }

  return rawKind;
};

const getParameterKinds = (parameters) => {
  const kinds = new Set([DEFAULT_PARAMETER_KIND]);
  parameters.forEach((parameter) => kinds.add(normalizeVariableKind(parameter)));

  return [...kinds].sort((left, right) => {
    if (left === DEFAULT_PARAMETER_KIND) {
      return -1;
    }

    if (right === DEFAULT_PARAMETER_KIND) {
      return 1;
    }

    const leftIndex = PARAMETER_KIND_ORDER.indexOf(left);
    const rightIndex = PARAMETER_KIND_ORDER.indexOf(right);
    if (leftIndex >= 0 && rightIndex >= 0) {
      return leftIndex - rightIndex;
    }

    if (leftIndex >= 0) {
      return -1;
    }

    if (rightIndex >= 0) {
      return 1;
    }

    return left.localeCompare(right);
  });
};

const renderParameterKindTabs = (kinds) => {
  if (!elements.parameterKindTabs) {
    return;
  }

  elements.parameterKindTabs.innerHTML = kinds.map((kind) => `
    <button
      class="variable-tab-btn${state.activeParameterKind === kind ? " active" : ""}"
      data-kind="${kind}"
      type="button"
    >
      ${kind}
    </button>
  `).join("");
};

const getVisibleParameters = (parameters) => {
  if (state.activeParameterKind === DEFAULT_PARAMETER_KIND) {
    return parameters;
  }

  return parameters.filter((parameter) => normalizeVariableKind(parameter) === state.activeParameterKind);
};

const getParameterNameOptions = () => {
  const names = state.parameterNames.length
    ? state.parameterNames
    : state.parameters.map((parameter) => parameter.name).filter(Boolean);

  const uniqueNames = [...new Set(names.filter(Boolean))];
  return uniqueNames
    .map((name) => ({
      name,
      label: getParameterLabelFromName(name),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
};

const renderParameterNameOptions = () => {
  if (!elements.writeName) {
    return;
  }

  const currentValue = String(elements.writeName.value || "").trim();
  const options = getParameterNameOptions();

  elements.writeName.innerHTML = [
    '<option value="">Select a parameter below</option>',
    ...options.map((option) => `<option value="${escapeHtml(option.name)}">${escapeHtml(option.label)}</option>`),
  ].join("");

  const preferred = currentValue || state.processParameter;
  if (preferred && options.some((option) => option.name === preferred)) {
    elements.writeName.value = preferred;
    return;
  }

  if (options.length) {
    elements.writeName.value = options[0].name;
  }
};

const loadParameterNames = async () => {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    state.parameterNames = state.parameters.map((parameter) => parameter.name).filter(Boolean);
    renderParameterNameOptions();
    return;
  }

  try {
    const names = await fetchJson(`${apiBaseUrl}/api/parameters/names?masterId=${encodeURIComponent(state.masterId)}&portNumber=${encodeURIComponent(state.portNumber)}`, {
      timeoutMs: 12000,
    });

    state.parameterNames = Array.isArray(names) ? names.filter(Boolean) : [];
    renderParameterNameOptions();
  } catch (error) {
    state.parameterNames = state.parameters.map((parameter) => parameter.name).filter(Boolean);
    renderParameterNameOptions();
    appendLog(`Parameter name list fallback: ${error.message}`);
  }
};

const ensureParameterNamesLoaded = async () => {
  if (state.parameterNames.length) {
    return;
  }

  await loadParameterNames();
};

const renderParameters = (parameters) => {
  const kinds = getParameterKinds(parameters);
  if (!kinds.includes(state.activeParameterKind)) {
    state.activeParameterKind = DEFAULT_PARAMETER_KIND;
  }

  renderParameterKindTabs(kinds);
  const visibleParameters = getVisibleParameters(parameters);
  renderParameterNameOptions();

  if (!parameters.length) {
    elements.parameterTableBody.innerHTML = `<tr><td colspan="6" class="empty-state">No parameters returned.</td></tr>`;
    return;
  }

  if (!visibleParameters.length) {
    elements.parameterTableBody.innerHTML = `<tr><td colspan="6" class="empty-state">No parameters available in ${state.activeParameterKind}.</td></tr>`;
    return;
  }

  elements.parameterTableBody.innerHTML = visibleParameters.map((parameter) => `
    <tr data-name="${escapeHtml(parameter.name)}">
      <td><strong>${escapeHtml(getParameterDisplayName(parameter))}</strong></td>
      <td class="value-cell">${renderParameterValueCell(parameter)}</td>
      <td>${escapeHtml(parameter.dataType || "-")}</td>
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

const readParameterByName = async (parameterNameInput, triggerButton = null) => {
  let parameterName = resolveParameterName(parameterNameInput);
  if (!parameterName) {
    await ensureParameterNamesLoaded();
    parameterName = resolveParameterName(elements.writeName.value.trim());
  }

  if (!parameterName && state.parameterNames.length) {
    parameterName = state.parameterNames[0];
  }

  if (!parameterName) {
    appendLog("Select a parameter before reading.");
    return;
  }

  const parameterLabel = getParameterLabelFromName(parameterName);
  const apiBaseUrl = getApiBaseUrl();
  const button = triggerButton || elements.readParameterBtn;

  elements.writeName.value = parameterName;

  if (!apiBaseUrl) {
    const parameter = getParameterByInternalName(parameterName);
    elements.writeValue.value = parameter?.value ?? "";
    appendLog(`Demo read ${parameterLabel}: ${parameter?.value ?? "n/a"}`);
    return;
  }

  if (button) {
    button.disabled = true;
  }

  appendLog(`Reading ${parameterLabel}...`);
  try {
    const result = await fetchJson(`${apiBaseUrl}/api/parameters/read`, {
      method: "POST",
      body: JSON.stringify({
        masterId: state.masterId,
        parameterName,
        portNumber: state.portNumber,
      }),
      timeoutMs: 20000,
    });

    updateParameterInState(parameterName, () => ({
      value: result?.value ?? "",
      minimum: result?.minimum,
      maximum: result?.maximum,
      dataType: result?.dataType,
      displayName: result?.displayName,
      index: result?.index,
      subindex: result?.subindex,
      variableKind: result?.variableKind,
    }));

    const updatedParam = state.parameters.find((parameter) => parameter.name === parameterName);
    const resultValue = result?.value ?? "";
    elements.writeValue.value = updatedParam?.value ?? resultValue;

    for (const tr of elements.parameterTableBody.querySelectorAll("tr[data-name]")) {
      if (tr.dataset.name === parameterName) {
        tr.querySelector(".value-cell").innerHTML = renderParameterValueCell(updatedParam);
        break;
      }
    }

    updateProcessRange(result?.minimum, result?.maximum);

    const readSnapshot = {
      parameterName,
      value: resultValue,
      rawValue: resultValue,
      minimum: result?.minimum,
      maximum: result?.maximum,
      displayName: result?.displayName,
      name: parameterName,
    };

    const signalNumber = getSwitchingSignalNumber(readSnapshot);
    if (signalNumber) {
      updateSwitchingSignal(signalNumber, resultValue);
    }

    if (isDistanceMdcSignal(readSnapshot) || parameterName === state.processParameter) {
      updateFromParameterValue(parameterName, resultValue, getParameterLabelFromName(parameterName));
    }

    appendLog(`Read ${parameterLabel}: ${resultValue === "" ? "(empty)" : resultValue}`);
  } catch (error) {
    appendLog(`Read failed for ${parameterLabel}: ${error.message}`);
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
};

const updateSessionLabels = () => {
  elements.masterIdLabel.textContent = state.masterId;
  elements.masterIdInput.value = state.masterId;
  elements.portNumberInput.value = state.portNumber;
};

const buildDemoParameters = () => [
  { name: "DISTANCE_MDC", display_name: DISTANCE_MDC_LABEL, value: "425", dataType: "UINT", index: 256, subindex: 1, variableKind: "Process Data" },
  { name: "TN_V_RANGE", display_name: "Detection Range", value: "950", dataType: "UINT", index: 257, subindex: 1, variableKind: "Standard Params" },
  { name: "TN_V_LEVEL", display_name: "Fluid Level", value: "72", dataType: "UINT", index: 258, subindex: 1, variableKind: "Standard Params" },
  { name: "TN_V_TEMP", display_name: "Sensor Temperature", value: "23.6", dataType: "FLOAT", index: 259, subindex: 1, variableKind: "Standard Params" },
  { name: "SP1", display_name: "Switching Signal 1", value: "1", dataType: "BOOL", index: 260, subindex: 1, variableKind: "Process Data" },
  { name: "SP2", display_name: "Switching Signal 2", value: "0", dataType: "BOOL", index: 260, subindex: 2, variableKind: "Process Data" },
];

const pickProcessParameter = (parameters) => {
  const processCandidates = parameters.filter((parameter) => {
    const kind = normalizeVariableKind(parameter);
    return kind !== "Commands" && kind !== "Events" && kind !== "PdOut";
  });

  const searchSet = processCandidates.length ? processCandidates : parameters;
  const preferred = searchSet.find((parameter) => isDistanceMdcSignal(parameter))
    || searchSet.find((parameter) => {
    const haystack = `${getParameterDisplayName(parameter)} ${parameter.name || ""}`;
    return /distance|range|level|actual|measure|measurement|output/i.test(haystack);
  })
    || searchSet.find((parameter) => /int|uint|float|double/i.test(parameter.dataType))
    || searchSet[0]
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

const updateProcessRange = (minimum, maximum) => {
  const parsedMinimum = parseFiniteNumber(minimum);
  const parsedMaximum = parseFiniteNumber(maximum);

  if (parsedMinimum !== null && parsedMaximum !== null && parsedMaximum > parsedMinimum) {
    state.processMinimum = parsedMinimum;
    state.processMaximum = parsedMaximum;
    return;
  }

  if (parsedMinimum !== null) {
    state.processMinimum = parsedMinimum;
  }

  if (parsedMaximum !== null) {
    state.processMaximum = parsedMaximum;
  }
};

const updateSwitchingSignal = (signalNumber, value) => {
  if (!signalNumber || !(signalNumber in state.switchingSignals)) {
    return;
  }

  state.switchingSignals[signalNumber] = toBooleanSignal(value);
  updateSwitchingIndicators();
};

const updateFromProcessSnapshot = (snapshot) => {
  updateProcessRange(snapshot.minimum, snapshot.maximum);

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

const stopDemoStream = () => {
  if (!state.demoTimer) {
    return;
  }

  window.clearInterval(state.demoTimer);
  state.demoTimer = null;
};

const startLiveStream = () => {
  const apiBaseUrl = getApiBaseUrl();
  stopDemoStream();

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
  let streamErrorCount = 0;

  state.liveSource = source;
  state.useDemoMode = false;
  elements.sourceModeLabel.textContent = "Cloud";
  elements.liveStatusChip.textContent = "Live stream connecting...";

  source.onopen = () => {
    streamErrorCount = 0;
    elements.liveStatusChip.textContent = "Live stream running";
    appendLog("Connected to live process stream.");
  };

  source.addEventListener("process", (event) => {
    const snapshot = JSON.parse(event.data);
    updateFromProcessSnapshot(snapshot);
  });

  source.onerror = () => {
    streamErrorCount += 1;
    elements.liveStatusChip.textContent = "Live stream reconnecting...";

    if (streamErrorCount >= 4) {
      source.close();
      if (state.liveSource === source) {
        state.liveSource = null;
      }

      state.useDemoMode = true;
      elements.sourceModeLabel.textContent = "Demo";
      elements.liveStatusChip.textContent = "Live stream demo fallback";
      appendLog("Live stream failed repeatedly, switched to demo stream.");
      startDemoStream();
    }
  };
};

const connectCloud = async () => {
  if (state.connectInFlight) {
    appendLog("Connect already in progress.");
    return;
  }

  state.connectInFlight = true;
  elements.connectBtn.disabled = true;
  setCloudState(false, "Connecting to cloud bridge...");

  state.masterId = elements.masterIdInput.value.trim() || "master-01";
  state.portNumber = Number(elements.portNumberInput.value || 0);
  updateSessionLabels();

  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    setCloudState(false, "Demo mode: no API base URL set");
    appendLog("Running in demo mode. Set the API base URL to connect to the cloud bridge.");
    startLiveStream();
    state.connectInFlight = false;
    elements.connectBtn.disabled = false;
    return;
  }

  try {
    const session = await fetchJsonWithRetry(`${apiBaseUrl}/api/session`, { method: "GET", timeoutMs: 4000 }, {
      attempts: 3,
      retryDelayMs: 250,
    });

    if (session?.masterId) {
      state.masterId = session.masterId;
      state.portNumber = session.defaultPortNumber ?? state.portNumber;
      updateSessionLabels();
    }

    if (session?.cloudConfigured === false) {
      const reason = session?.cloudMessage || "Cloud bridge reachable, but backend is unavailable.";
      setCloudState(false, reason);
      appendLog(reason);
      state.useDemoMode = true;
      elements.sourceModeLabel.textContent = "Demo";
      elements.liveStatusChip.textContent = "Live stream demo fallback";
      startDemoStream();
      return;
    }

    setCloudState(true, session?.cloudMessage || "Cloud bridge ready");
    appendLog("Cloud connection established.");
    await loadParameterNames();
    startLiveStream();
  } catch (error) {
    setCloudState(false, `Cloud connection failed: ${error.message}`);
    appendLog(`Cloud connection failed: ${error.message}`);
    state.useDemoMode = true;
    elements.sourceModeLabel.textContent = "Demo";
    elements.liveStatusChip.textContent = "Live stream demo fallback";
    startDemoStream();
  } finally {
    state.connectInFlight = false;
    elements.connectBtn.disabled = false;
  }
};

const loadSensor = async () => {
  state.masterId = elements.masterIdInput.value.trim() || "master-01";
  state.portNumber = Number(elements.portNumberInput.value || 0);
  updateSessionLabels();

  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    state.parameters = buildDemoParameters();
    state.parameterNames = state.parameters.map((parameter) => parameter.name).filter(Boolean);
    state.processParameter = pickProcessParameter(state.parameters);
    renderParameters(state.parameters);
    renderParameterNameOptions();
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
      timeoutMs: 20000,
      body: JSON.stringify({
        masterId: state.masterId,
        portNumber: state.portNumber,
      }),
    });

    state.parameters = bootstrap.parameters || [];
    state.parameterNames = state.parameters.map((parameter) => parameter.name).filter(Boolean);
    state.processParameter = bootstrap.suggestedProcessParameter || pickProcessParameter(state.parameters);
    renderParameters(state.parameters);
    await loadParameterNames();
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
    state.parameterNames = state.parameters.map((parameter) => parameter.name).filter(Boolean);
    state.processParameter = pickProcessParameter(state.parameters);
    renderParameters(state.parameters);
    renderParameterNameOptions();
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
    state.parameterNames = state.parameters.map((parameter) => parameter.name).filter(Boolean);
    renderParameters(state.parameters);
    renderParameterNameOptions();
    appendLog(`Demo parameters refreshed: ${state.parameters.length} items`);
    return;
  }

  try {
    const parameters = await fetchJson(`${apiBaseUrl}/api/parameters?portNumber=${state.portNumber}`, {
      timeoutMs: 20000,
    });

    state.parameters = parameters;
    state.parameterNames = parameters.map((parameter) => parameter.name).filter(Boolean);
    renderParameters(parameters);
    await loadParameterNames();
    appendLog(`Parameters refreshed: ${parameters.length} items`);
  } catch (error) {
    appendLog(`Parameter refresh failed: ${error.message}`);
  }
};

elements.connectBtn.addEventListener("click", connectCloud);
elements.loadSensorBtn.addEventListener("click", loadSensor);
elements.refreshParamsBtn.addEventListener("click", refreshParameters);
elements.parameterTableBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const row = button.closest("tr[data-name]");
  const parameterName = row?.dataset.name || "";
  if (!parameterName) {
    return;
  }

  const parameterLabel = getParameterLabelFromName(parameterName);
  const action = button.dataset.action;

  if (action === "edit") {
    const parameter = getParameterByInternalName(parameterName);
    elements.writeName.value = parameterName;
    elements.writeValue.value = parameter?.value ?? "";
    elements.writeValue.focus();
    appendLog(`Ready to edit ${parameterLabel}`);
    return;
  }

  if (action !== "read") {
    return;
  }

  await readParameterByName(parameterName, button);
});
elements.parameterKindTabs?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-kind]");
  if (!button) {
    return;
  }

  const selectedKind = button.dataset.kind || DEFAULT_PARAMETER_KIND;
  if (state.activeParameterKind === selectedKind) {
    return;
  }

  state.activeParameterKind = selectedKind;
  renderParameters(state.parameters);
});

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
    updateParameterInState(parameterName, () => ({ value: updatedValue }));

    // Update just the value cell in place — avoids a full table re-render
    const updatedParam = state.parameters.find((p) => p.name === parameterName);
    for (const tr of elements.parameterTableBody.querySelectorAll("tr[data-name]")) {
      if (tr.dataset.name === parameterName) {
        tr.querySelector(".value-cell").innerHTML = renderParameterValueCell(updatedParam);
        break;
      }
    }

    appendLog(`Wrote ${parameterLabel} = ${updatedValue}`);
    elements.writeValue.value = "";
  } catch (error) {
    appendLog(`Write failed for ${parameterLabel}: ${error.message}`);
  }
});

elements.readParameterBtn?.addEventListener("click", async () => {
  await readParameterByName(elements.writeName.value.trim());
});

elements.writeName?.addEventListener("focus", async () => {
  await ensureParameterNamesLoaded();
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
  renderParameterNameOptions();
  setApplication("object");
  updateDistanceRangeLabels();
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
