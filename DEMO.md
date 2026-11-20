# Demo recording — edge-post

A 4:30 screen-capture walkthrough of a full device-to-dashboard round trip without hardware, using the backend TCP simulator and the demo fleet built into the dashboard.

## Recording flow (target 4:30)

| Segment | Approx. | What to show |
|---------|---------|--------------|
| 1. Stack startup | 0:45 | `docker compose up -d`, healthy containers, dashboard loads at `localhost:3000` |
| 2. Live telemetry | 1:00 | Simulated devices register over TCP, readings appear in the fleet index and trend chart |
| 3. Toggle GPIO | 0:45 | Enqueue `toggle_gpio` over REST, watch the acknowledgement and the GPIO bitmask in the next reading |
| 4. Set sample rate | 0:45 | Enqueue `set_sample_rate`, confirm the rate changes in subsequent readings |
| 5. Reading history | 0:45 | Open device detail, adjust the history range, verify points merge with the live feed |
| 6. WebSocket live feed | 0:30 | Open a second browser tab, confirm both tabs receive the same readings without a manual refresh |

## Prerequisites before recording

1. Build the dashboard so the backend serves it:
   ```bash
   cd dashboard && npm ci && npm run build && cd ..
   ```
2. Start the stack:
   ```bash
   docker compose build && docker compose up -d
   ```
3. Confirm both containers are healthy:
   ```bash
   docker compose ps
   ```
4. Open `http://localhost:3000/` and confirm the dashboard loads with no console errors.

## Segment 1 — Stack startup (0:45)

Run `docker compose up -d` and show the backend and database containers become healthy. Open `http://localhost:3000/` to load the operator console. The fleet index starts empty until simulated devices connect.

The backend serves HTTP on port 3000 and device frames on port 9000. `firmware/boards/` is mounted read-only, so `GET /api/v1/boards` returns the synthetic board profile from the locally generated catalog.

## Segment 2 — Live telemetry (1:00)

Start the backend TCP simulator, which transmits real binary reading frames for the demo fleet:

```bash
cd backend && npm run simulate
```

Watch the fleet index populate as devices auto-register from their first reading. Confirm:
- Each device appears with its name, sample rate, and online status.
- The trend chart draws the temperature trace for the selected device.
- The sparkline in each fleet row updates as new readings arrive.
- The frame ledger shows the most recent frames per device.

The dashboard reconnects to `/ws` with backoff if the socket drops, and resubscribes to the current device list.

## Segment 3 — Toggle GPIO (0:45)

Select a device and open the control console. Enqueue a `toggle_gpio` command:

```json
{ "deviceId": 4660, "type": "toggle_gpio", "payload": { "pin": 3, "state": 1 } }
```

Confirm:
- The command is stored with status `pending`, then `delivered` when polled.
- The device acknowledges with status `executed`.
- The GPIO bitmask in the next reading reflects pin 3 high.
- The presence health chip stays online during the exchange.

## Segment 4 — Set sample rate (0:45)

Enqueue a `set_sample_rate` command:

```json
{ "deviceId": 4660, "type": "set_sample_rate", "payload": { "seconds": 10 } }
```

Confirm:
- The command is delivered and acknowledged as `executed`.
- The next reading reports the new sample rate.
- Subsequent readings arrive at the new interval.

## Segment 5 — Reading history (0:45)

Open device detail for one device. Adjust the history range (default one hour, maximum seven days). Confirm:
- Historical points load through `/api/v1/readings`.
- Live points from the WebSocket merge into the chart without duplicates.
- The latest reading panel shows the current temperature, GPIO bitmask, and sample rate.

## Segment 6 — WebSocket live feed (0:30)

Open the dashboard in a second browser tab. Confirm both tabs:
- Receive the same readings within the sample interval.
- Show the same fleet status and presence changes.
- Close one tab without affecting the other.

## Post-recording

Stop and clean up the stack:

```bash
docker compose down
```

Add `-v` to remove the database volume and reapply `backend/schema.sql` on the next start.

## Notes

- The simulator acknowledges applied commands with status `0` (executed). A queued command is stored as `executed` after the simulator applies it, and the next readings report the new sample rate.
- The dashboard loads no remote assets; fonts and icons are bundled locally.
- No real hardware is required for this flow; the simulator drives real binary frames over TCP.
- Do not record or publish board pin data, `.ioc` files, or generated `board_config.h`/`boards.json` contents; they stay local and ignored.
