const http = require('http');
const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const rootDir = __dirname;
const webPort = Number(process.env.PORT || 8000);
const grpcTarget = process.env.GRPC_TARGET || '127.0.0.1:5176';
const defaultMasterId = process.env.MASTER_ID || 'master-01';
const defaultPortNumber = Number(process.env.SENSOR_PORT || 0);
const protoPath = process.env.PROTO_PATH
  || path.resolve(rootDir, '..', '..', 'onedriver-master', 'OneDriver.Master', 'OneDriver.Master.IoLink.gRPC', 'Protos', 'iolink_master.proto');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDefinition).iolink_master;
const grpcClient = new proto.IoLinkMasterService(grpcTarget, grpc.credentials.createInsecure());

const grpcCallTimeoutMs = Number(process.env.GRPC_CALL_TIMEOUT_MS || 12000);
const grpcReadyTimeoutMs = Number(process.env.GRPC_READY_TIMEOUT_MS || 2000);
const grpcRetryCount = Math.max(1, Number(process.env.GRPC_RETRY_COUNT || 1));
const retryableGrpcCodes = new Set([
  grpc.status.UNAVAILABLE,
  grpc.status.DEADLINE_EXCEEDED,
  grpc.status.RESOURCE_EXHAUSTED,
  grpc.status.INTERNAL,
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForGrpcReady(timeoutMs = grpcReadyTimeoutMs) {
  return new Promise((resolve, reject) => {
    grpcClient.waitForReady(Date.now() + timeoutMs, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function callGrpc(methodName, request, options = {}) {
  const timeoutMs = Number(options.timeoutMs || grpcCallTimeoutMs);
  const retries = Math.max(1, Number(options.retries || grpcRetryCount));
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      // Unary calls get explicit deadlines to prevent hanging requests.
      const response = await new Promise((resolve, reject) => {
        grpcClient[methodName](
          request,
          new grpc.Metadata(),
          { deadline: Date.now() + timeoutMs },
          (error, value) => {
            if (error) {
              reject(error);
              return;
            }

            resolve(value);
          },
        );
      });

      return response;
    } catch (error) {
      lastError = error;
      const shouldRetry = retryableGrpcCodes.has(error?.code) && attempt < retries;
      if (!shouldRetry) {
        break;
      }

      await sleep(150 * attempt);
    }
  }

  throw lastError || new Error(`gRPC call failed for ${methodName}`);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(payload);
      } catch (err) {
        reject(new Error('Invalid JSON payload.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message, details) {
  sendJson(res, statusCode, {
    error: message,
    details: details || null,
  });
}

function normalizeForAnimation(rawValue) {
  const numeric = Number.parseFloat(rawValue);
  if (Number.isNaN(numeric)) {
    const normalized = (String(rawValue || '').length % 25) / 24;
    return Math.max(0, Math.min(1, normalized));
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
}

function formatHex(dataBuffer) {
  if (!dataBuffer || dataBuffer.length === 0) {
    return '';
  }

  return dataBuffer.toString('hex').match(/.{1,2}/g)?.join(' ') || '';
}

function decodeProcessData(dataBuffer) {
  if (!dataBuffer || dataBuffer.length === 0) {
    return '';
  }

  if (dataBuffer.length <= 6) {
    let unsigned = 0;
    for (let i = 0; i < dataBuffer.length; i += 1) {
      unsigned += dataBuffer[i] * (2 ** (8 * i));
    }
    return String(unsigned);
  }

  return formatHex(dataBuffer);
}

function mapVariable(variable, fallbackName) {
  return {
    name: variable?.name || fallbackName || '',
    displayName: variable?.displayName || variable?.name || fallbackName || '',
    value: variable?.value || '',
    dataType: variable?.dataType || '',
    minimum: variable?.minimum || '',
    maximum: variable?.maximum || '',
    index: variable?.index || 0,
    subindex: variable?.subindex || 0,
    lengthInBits: variable?.lengthInBits || 0,
    offset: variable?.offset || 0,
    isDynamic: variable?.isDynamic || false,
    arrayCount: variable?.arrayCount || 0,
    variableKind: variable?.variableKind || 'Other',
  };
}

function inferVariableKind(variable, sourceKind = 'parameter') {
  if (sourceKind === 'command') {
    return 'Commands';
  }

  const index = Number(variable?.index || 0);
  const haystack = `${variable?.displayName || ''} ${variable?.name || ''}`.toLowerCase();

  if (/specific|vendor|application/.test(haystack)) {
    return 'Specific';
  }

  if (/standard|\bstd\b/.test(haystack)) {
    return 'Standard Params';
  }

  // IO-Link vendor specific indices are typically >= 0x4000.
  if (index >= 0x4000) {
    return 'Specific';
  }

  if (index > 0) {
    return 'Standard Params';
  }

  return 'Other';
}

function mapKnownVariableKind(kind) {
  const normalized = String(kind || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (/^system/.test(normalized)) {
    return 'System';
  }

  if (/^specific|vendor|application/.test(normalized)) {
    return 'Specific';
  }

  if (/^standard|std/.test(normalized)) {
    return 'Standard Params';
  }

  if (/^process/.test(normalized)) {
    return 'Process Data';
  }

  if (/^command/.test(normalized)) {
    return 'Commands';
  }

  if (/^event/.test(normalized)) {
    return 'Events';
  }

  if (/^pd\s*in|^pdin|process\s*data\s*in|process\s*input/.test(normalized)) {
    return 'PdIn';
  }

  if (/^pd\s*out|^pdout|process\s*data\s*out|process\s*output/.test(normalized)) {
    return 'PdOut';
  }

  return String(kind).trim();
}

function resolveVariableKind(descriptorVariable, parameter, sourceKind = 'parameter') {
  if (sourceKind === 'command') {
    return 'Commands';
  }

  const descriptorKind = mapKnownVariableKind(descriptorVariable?.variableKind);
  if (descriptorKind) {
    return descriptorKind;
  }

  const parameterKind = mapKnownVariableKind(parameter?.variableKind);
  if (parameterKind) {
    return parameterKind;
  }

  return inferVariableKind(descriptorVariable || parameter, sourceKind);
}

function processSignalScore(parameter) {
  const label = `${parameter?.displayName || ''} ${parameter?.name || ''}`.toLowerCase();
  let score = 0;

  if (/\bmdc\b/.test(label) && (/measurement\s*value/.test(label) || /\bdistance\b/.test(label))) {
    score += 320;
  }

  if (/mdc|measurement\s*value|distance|range|level|actual|measure|output/.test(label)) {
    score += 120;
  }

  if (/switching\s*signal|\bssc\b/.test(label)) {
    score -= 80;
  }

  if (/scale|descriptor|device\s*char|sensrng|min\.\s*sensing\s*range|max\.\s*sensing\s*range|\bminimum\b|\bmaximum\b|\bmin\b|\bmax\b/.test(label)) {
    score -= 220;
  }

  if (/teach|tag|config|mode|product|location|uri|install|command|\bcmd\b/.test(label)) {
    score -= 140;
  }

  if (/int|uint|float|double/i.test(String(parameter?.dataType || ''))) {
    score += 20;
  }

  return score;
}

function pickProcessParameter(parameters) {
  if (!parameters?.length) {
    return '';
  }

  const preferred = [...parameters]
    .sort((left, right) => processSignalScore(right) - processSignalScore(left))[0]
    || parameters[0];

  return preferred?.name || '';
}

function getDescriptorCollection(source, ...keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }

  return [];
}

function getDescriptorProcessCandidates(descriptor) {
  const variables = descriptor?.variables || {};

  return [
    ...getDescriptorCollection(variables, 'pdInCollection', 'pdinCollection', 'pdincollection', 'pdIn', 'pdin'),
    ...getDescriptorCollection(descriptor, 'pdInCollection', 'pdinCollection', 'pdincollection', 'pdIn', 'pdin'),
  ];
}

function pickDescriptorProcessParameter(descriptor) {
  return pickProcessParameter(getDescriptorProcessCandidates(descriptor));
}

async function getDescriptorByName(masterId) {
  const descriptor = await callGrpc('GetDescriptor', { masterId });
  const descriptorParameters = [
    ...getDescriptorCollection(descriptor.variables || descriptor, 'parameters'),
    ...getDescriptorCollection(descriptor.variables || descriptor, 'commands'),
    ...getDescriptorCollection(descriptor.variables || descriptor, 'events', 'eventsCollection'),
    ...getDescriptorCollection(descriptor.variables || descriptor, 'pdIn', 'pdin', 'pdInCollection', 'pdinCollection', 'pdincollection'),
    ...getDescriptorCollection(descriptor.variables || descriptor, 'pdOut', 'pdout', 'pdOutCollection', 'pdoutCollection'),
  ];
  const descriptorByName = new Map(descriptorParameters.map((variable) => [variable?.name || '', variable]));

  return {
    descriptor,
    descriptorByName,
  };
}

function enrichParameterWithDescriptor(parameter, descriptorByName) {
  const descriptorVariable = descriptorByName.get(parameter.name) || null;
  return {
    ...parameter,
    displayName: descriptorVariable?.displayName || parameter.displayName || parameter.name,
    index: descriptorVariable?.index || parameter.index,
    subindex: descriptorVariable?.subindex || parameter.subindex,
    dataType: descriptorVariable?.dataType || parameter.dataType,
    minimum: descriptorVariable?.minimum || parameter.minimum,
    maximum: descriptorVariable?.maximum || parameter.maximum,
    variableKind: resolveVariableKind(descriptorVariable, parameter, 'parameter'),
  };
}

async function getEnrichedParameterValues(masterId, portNumber) {
  const [parameters, { descriptorByName }] = await Promise.all([
    getAllParameterValues(masterId, portNumber),
    getDescriptorByName(masterId),
  ]);

  const valuesByName = new Map();
  parameters.forEach((parameter) => {
    if (!parameter?.name) {
      return;
    }

    valuesByName.set(parameter.name, parameter);
  });

  const merged = [];
  descriptorByName.forEach((descriptorVariable, name) => {
    if (!name) {
      return;
    }

    const liveValue = valuesByName.get(name);
    const mappedBase = liveValue || mapVariable(descriptorVariable, name);
    merged.push(enrichParameterWithDescriptor(mappedBase, descriptorByName));
    valuesByName.delete(name);
  });

  valuesByName.forEach((leftover) => {
    merged.push(enrichParameterWithDescriptor(leftover, descriptorByName));
  });

  return merged;
}

async function getAllParameterValues(masterId, portNumber) {
  const all = await callGrpc('GetAllParameters', { masterId, portNumber });
  const names = all.parameterNames || [];
  const values = [];
  const batchSize = 8;

  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    const batchValues = await Promise.all(batch.map(async (name) => {
      try {
        const read = await callGrpc('ReadParameter', {
          masterId,
          parameterName: name,
          portNumber,
        }, {
          timeoutMs: Math.max(grpcCallTimeoutMs, 15000),
          retries: 1,
        });

        return mapVariable(read.variable, name);
      } catch (_) {
        return mapVariable(null, name);
      }
    }));

    values.push(...batchValues);
  }

  return values;
}

function serveStatic(requestPath, res) {
  const relativePath = requestPath === '/' ? '/index.html' : requestPath;
  const resolvedPath = path.resolve(rootDir, `.${relativePath}`);

  if (!resolvedPath.startsWith(rootDir)) {
    sendError(res, 403, 'Forbidden path.');
    return;
  }

  fs.stat(resolvedPath, (statError, stats) => {
    if (!statError && stats.isFile()) {
      const ext = path.extname(resolvedPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(resolvedPath).pipe(res);
      return;
    }

    const fallbackPath = path.join(rootDir, 'index.html');
    fs.readFile(fallbackPath, (readError, data) => {
      if (readError) {
        sendError(res, 500, 'Unable to load index.html', readError.message);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  try {
    if (req.method === 'GET' && pathname === '/api/session') {
      let cloudConfigured = false;
      let cloudMessage = '';

      try {
        await waitForGrpcReady();
        await callGrpc('GetDescriptor', { masterId: defaultMasterId }, { retries: 1 });
        cloudConfigured = true;
        cloudMessage = 'Cloud bridge ready';
      } catch (err) {
        cloudConfigured = false;
        cloudMessage = `gRPC backend unavailable: ${err.message}`;
      }

      sendJson(res, 200, {
        masterId: defaultMasterId,
        defaultPortNumber,
        cloudConfigured,
        cloudMessage,
        backendType: 'grpc-adapter',
        grpcTarget,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/sensor/bootstrap') {
      const body = await readJsonBody(req);
      const masterId = body.masterId || defaultMasterId;
      const portNumber = Number.isFinite(body.portNumber) ? Number(body.portNumber) : defaultPortNumber;

      // Load metadata from descriptor only — no device reads at bootstrap time.
      // Values are empty; users click Read on individual rows to fetch live values.
      const { descriptor, descriptorByName } = await getDescriptorByName(masterId);

      const parameters = [];
      descriptorByName.forEach((descriptorVariable, name) => {
        if (!name) return;
        const mapped = mapVariable(descriptorVariable, name);
        parameters.push(enrichParameterWithDescriptor(mapped, descriptorByName));
      });

      const commands = (descriptor.commands || []).map((command) => ({
        ...mapVariable(command, command?.name || ''),
        variableKind: resolveVariableKind(command, command, 'command'),
      }));
      const suggested = pickProcessParameter(parameters);

      sendJson(res, 200, {
        masterId,
        sensorConnected: parameters.length > 0,
        productName: 'UB6000-F42-2EP-IO-V15',
        suggestedProcessParameter: suggested,
        parameterCount: descriptor.parameterCount || parameters.length,
        commandCount: descriptor.commandCount || 0,
        parameters,
        commands,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/parameters') {
      const masterId = requestUrl.searchParams.get('masterId') || defaultMasterId;
      const portNumber = Number(requestUrl.searchParams.get('portNumber') || defaultPortNumber);
      const parameters = await getEnrichedParameterValues(masterId, portNumber);
      sendJson(res, 200, parameters);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/parameters/names') {
      const masterId = requestUrl.searchParams.get('masterId') || defaultMasterId;
      const portNumber = Number(requestUrl.searchParams.get('portNumber') || defaultPortNumber);
      const all = await callGrpc('GetAllParameters', { masterId, portNumber });
      sendJson(res, 200, all.parameterNames || []);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/parameters/read') {
      const body = await readJsonBody(req);
      const masterId = body.masterId || defaultMasterId;
      const parameterName = body.parameterName;
      const portNumber = Number.isFinite(body.portNumber) ? Number(body.portNumber) : defaultPortNumber;

      if (!parameterName) {
        sendError(res, 400, 'parameterName is required.');
        return;
      }

      const result = await callGrpc('ReadParameter', {
        masterId,
        parameterName,
        portNumber,
      }, {
        timeoutMs: Math.max(grpcCallTimeoutMs, 20000),
        retries: Math.max(1, grpcRetryCount),
      });

      if (result.errorCode && result.errorCode !== 0) {
        sendError(res, 400, result.errorMessage || 'ReadParameter failed.');
        return;
      }

      const mapped = mapVariable(result.variable, parameterName);
      try {
        const { descriptorByName } = await getDescriptorByName(masterId);
        sendJson(res, 200, enrichParameterWithDescriptor(mapped, descriptorByName));
      } catch (_) {
        // If descriptor lookup is unavailable, return the live read value anyway.
        sendJson(res, 200, mapped);
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/parameters/write') {
      const body = await readJsonBody(req);
      const masterId = body.masterId || defaultMasterId;
      const parameterName = body.parameterName;
      const value = body.value;
      const portNumber = Number.isFinite(body.portNumber) ? Number(body.portNumber) : defaultPortNumber;

      if (!parameterName) {
        sendError(res, 400, 'parameterName is required.');
        return;
      }

      const writeResult = await callGrpc('WriteParameter', {
        masterId,
        parameterName,
        value: value == null ? '' : String(value),
        portNumber,
      });

      if (writeResult?.errorCode && writeResult.errorCode !== 0) {
        sendError(res, 400, writeResult.errorMessage || 'WriteParameter failed.');
        return;
      }

      const reread = await callGrpc('ReadParameter', {
        masterId,
        parameterName,
        portNumber,
      });

      const { descriptorByName } = await getDescriptorByName(masterId);
      const mapped = mapVariable(reread.variable, parameterName);

      sendJson(res, 200, {
        message: 'Parameter updated.',
        parameter: enrichParameterWithDescriptor(mapped, descriptorByName),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/process/live') {
      const masterId = requestUrl.searchParams.get('masterId') || defaultMasterId;
      const portNumber = Number(requestUrl.searchParams.get('portNumber') || defaultPortNumber);
      const application = requestUrl.searchParams.get('application') || 'object';
      let descriptor = null;
      let descriptorByName = null;

      let parameterName = requestUrl.searchParams.get('parameterName');
      if (!parameterName) {
        ({ descriptor, descriptorByName } = await getDescriptorByName(masterId));
        parameterName = pickDescriptorProcessParameter(descriptor) || pickProcessParameter([...descriptorByName.values()]);
      }

      if (!parameterName) {
        sendError(res, 400, 'No process parameter could be resolved.');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      res.write(': connected\n\n');

      let timer = null;
      let stream = null;
      let isClosed = false;

      const stopPolling = () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      };

      const stopStream = () => {
        if (stream) {
          stream.removeAllListeners();
          stream.on('error', () => {}); // absorb the CANCELLED error emitted after cancel()
          stream.cancel();
          stream = null;
        }
      };

      const startPollingFallback = () => {
        if (timer || isClosed) {
          return;
        }

        res.write('event: warning\n');
        res.write(`data: ${JSON.stringify({ message: 'Falling back to descriptor-backed polling mode.' })}\n\n`);

        let pollInFlight = false;

        timer = setInterval(async () => {
          if (pollInFlight || isClosed) {
            return;
          }

          pollInFlight = true;
          try {
            ({ descriptor, descriptorByName } = await getDescriptorByName(masterId));
            const processParameter = descriptorByName.get(parameterName)
              || descriptorByName.get(pickDescriptorProcessParameter(descriptor))
              || null;
            const rawValue = processParameter?.value || '';
            const payload = {
              masterId,
              application,
              parameterName: processParameter?.name || parameterName,
              displayName: processParameter?.displayName || processParameter?.name || parameterName,
              rawValue,
              value: rawValue,
              normalizedValue: normalizeForAnimation(rawValue),
              minimum: processParameter?.minimum || '',
              maximum: processParameter?.maximum || '',
              mode: 'descriptor-polling',
              timestamp: new Date().toISOString(),
            };

            res.write('event: process\n');
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          } catch (err) {
            res.write('event: error\n');
            res.write(`data: ${JSON.stringify({ message: err.message })}\n\n`);
          } finally {
            pollInFlight = false;
          }
        }, 1000);
      };

      try {
        stream = grpcClient.StreamProcessData({ masterId, portNumber });

        stream.on('data', (update) => {
          if (isClosed) {
            return;
          }

          const dataBuffer = Buffer.isBuffer(update.data) ? update.data : Buffer.from(update.data || []);
          const decoded = decodeProcessData(dataBuffer);
          const hexData = formatHex(dataBuffer);

          const payload = {
            masterId,
            application,
            parameterName: update.parameterName || parameterName,
            displayName: update.displayName || update.parameterName || parameterName,
            rawValue: update.value || decoded,
            value: update.value || decoded,
            normalizedValue: normalizeForAnimation(update.value || decoded),
            minimum: update.minimum || '',
            maximum: update.maximum || '',
            dataType: update.dataType || '',
            mode: 'stream',
            channelNumber: update.channelNumber,
            index: update.index,
            subindex: update.subindex,
            rawHex: hexData,
            timestamp: update.timestamp ? new Date(Number(update.timestamp)).toISOString() : new Date().toISOString(),
          };

          res.write('event: process\n');
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        });

        stream.on('error', (err) => {
          if (isClosed) {
            return;
          }

          res.write('event: error\n');
          res.write(`data: ${JSON.stringify({ message: `StreamProcessData error: ${err.message}` })}\n\n`);
          startPollingFallback();
        });

        stream.on('end', () => {
          if (isClosed) {
            return;
          }

          startPollingFallback();
        });
      } catch (err) {
        res.write('event: error\n');
        res.write(`data: ${JSON.stringify({ message: `StreamProcessData setup failed: ${err.message}` })}\n\n`);
        startPollingFallback();
      }

      req.on('close', () => {
        isClosed = true;
        stopPolling();
        stopStream();
      });
      return;
    }

    serveStatic(pathname, res);
  } catch (err) {
    sendError(res, 500, 'Request failed.', err.message);
  }
});

server.listen(webPort, '0.0.0.0', () => {
  console.log(`OneDriver WebUI running at http://localhost:${webPort}`);
  console.log(`OneDriver WebUI listening on 0.0.0.0:${webPort}`);
  console.log(`gRPC adapter target: ${grpcTarget}`);
  console.log(`Proto file: ${protoPath}`);
});