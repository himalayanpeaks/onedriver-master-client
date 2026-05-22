# OneDriver Ultrasonic WebUI

Standalone frontend for the ultrasonic sensor proof of concept.

## What it does

- Connects to a backend API if an API base URL is provided.
- Loads ultrasonic sensor data and parameters.
- Shows two visual modes:
  - Object Detection
  - Fluid Level Measurement
- Lets the user edit simple sensor parameters.
- Falls back to demo mode when no backend is configured.

## Run

From the `webui` folder, run:

```powershell
npm start
```

Then open `http://localhost:8000`.

The local server now includes a gRPC adapter and expects your OneDriver backend to be running at `localhost:5176`.

Optional environment variables:

- `GRPC_TARGET` (default: `localhost:5176`)
- `MASTER_ID` (default: `master-01`)
- `SENSOR_PORT` (default: `0`)
- `PORT` (default: `8000`)

If you do not want to use npm, you can also open `index.html` directly in a browser. The page will fall back to demo mode if no backend is configured.

If the backend is available, set the API base URL in the UI, for example:

- `http://localhost:5092`

The page expects these endpoints when a backend is connected:

- `GET /api/session`
- `POST /api/sensor/bootstrap`
- `GET /api/parameters?portNumber=0`
- `POST /api/parameters/read`
- `POST /api/parameters/write`
- `GET /api/process/live`
