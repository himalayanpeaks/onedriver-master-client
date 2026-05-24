const http = require('http');
const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const rootDir = __dirname;
const webPort = Number(process.env.PORT || 8000);
const grpcTarget = process.env.GRPC_TARGET || 'localhost:5176';
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

function callGrpc(methodName, request) {
  return new Promise((resolve, reject) => {
    grpcClient[methodName](request, (error, response) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(response);
    });
  });
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

async function getDescriptorByName(masterId) {
  const descriptor = await callGrpc('GetDescriptor', { masterId });
  const descriptorParameters = descriptor.parameters || [];
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
    variableKind: inferVariableKind(descriptorVariable || parameter, 'parameter'),
  };
}

async function getEnrichedParameterValues(masterId, portNumber) {
  const [parameters, { descriptorByName }] = await Promise.all([
    getAllParameterValues(masterId, portNumber),
    getDescriptorByName(masterId),
  ]);

  return parameters.map((parameter) => enrichParameterWithDescriptor(parameter, descriptorByName));
}

async function getAllParameterValues(masterId, portNumber) {
  const all = await callGrpc('GetAllParameters', { masterId, portNumber });
  const names = all.parameterNames || [];
  const values = [];

  for (const name of names) {
    try {
      const read = await callGrpc('ReadParameter', {
        masterId,
        parameterName: name,
        portNumber,
      });

      values.push(mapVariable(read.variable, name));
    } catch (_) {
      values.push(mapVariable(null, name));
    }
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
      sendJson(res, 200, {
        masterId: defaultMasterId,
        defaultPortNumber,
        cloudConfigured: true,
        backendType: 'grpc-adapter',
        grpcTarget,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/sensor/bootstrap') {
      const body = await readJsonBody(req);
      const masterId = body.masterId || defaultMasterId;
      const portNumber = Number.isFinite(body.portNumber) ? Number(body.portNumber) : defaultPortNumber;

      const { descriptor } = await getDescriptorByName(masterId);
      const enrichedParameters = await getEnrichedParameterValues(masterId, portNumber);

      const commands = (descriptor.commands || []).map((command) => ({
        ...mapVariable(command, command?.name || ''),
        variableKind: inferVariableKind(command, 'command'),
      }));
      const suggested = pickProcessParameter(enrichedParameters);

      sendJson(res, 200, {
        masterId,
        sensorConnected: enrichedParameters.length > 0,
        productName: 'UB6000-F42-2EP-IO-V15',
        suggestedProcessParameter: suggested,
        parameterCount: descriptor.parameterCount || enrichedParameters.length,
        commandCount: descriptor.commandCount || 0,
        parameters: enrichedParameters,
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
      });

      if (result.errorCode && result.errorCode !== 0) {
        sendError(res, 400, result.errorMessage || 'ReadParameter failed.');
        return;
      }

      const { descriptorByName } = await getDescriptorByName(masterId);
      const mapped = mapVariable(result.variable, parameterName);
      sendJson(res, 200, enrichParameterWithDescriptor(mapped, descriptorByName));
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

      await callGrpc('WriteParameter', {
        masterId,
        parameterName,
        value: value == null ? '' : String(value),
        portNumber,
      });

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

      let parameterName = requestUrl.searchParams.get('parameterName');
      if (!parameterName) {
        const parameters = await getAllParameterValues(masterId, portNumber);
        parameterName = pickProcessParameter(parameters);
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
        res.write(`data: ${JSON.stringify({ message: 'Falling back to polling mode.' })}\n\n`);

        timer = setInterval(async () => {
          try {
            const read = await callGrpc('ReadParameter', {
              masterId,
              parameterName,
              portNumber,
            });

            const rawValue = read.variable?.value || '';
            const payload = {
              masterId,
              application,
              parameterName,
              displayName: parameterName,
              rawValue,
              value: rawValue,
              normalizedValue: normalizeForAnimation(rawValue),
              minimum: read.variable?.minimum || '',
              maximum: read.variable?.maximum || '',
              mode: 'polling',
              timestamp: new Date().toISOString(),
            };

            res.write('event: process\n');
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          } catch (err) {
            res.write('event: error\n');
            res.write(`data: ${JSON.stringify({ message: err.message })}\n\n`);
          }
        }, 500);
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

server.listen(webPort, () => {
  console.log(`OneDriver WebUI running at http://localhost:${webPort}`);
  console.log(`gRPC adapter target: ${grpcTarget}`);
  console.log(`Proto file: ${protoPath}`);
});