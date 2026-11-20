/*
 * edge-post firmware composition root — example reference.
 *
 * Wires the board-specific implementations (clock, sensors, TCP client) into
 * the shared application loop (app.c). The board-specific files include
 * board_config.h, which is generated from your CubeMX .ioc and provides the
 * BOARD_TEMP_*, BOARD_NET_*, BOARD_OUT* role macros.
 *
 * Build example (from firmware/):
 *   make BOARD=example-board CFLAGS+="-DCONFIG_DEVICE_ID=42"
 */

#include "app.h"
#include "board_clock.h"
#include "board_sensors.h"
#include "board_tcp_client.h"
#include "config.h"

#include <stdint.h>

/*
 * Application context. Allocated here so it persists for the lifetime of the
 * device.
 */
static app_context_t g_app;

/* One frame-sized buffer is enough; app.c encodes into stack buffers directly. */

int main(void)
{
    /* 1. Initialize board clock (RTC, system tick). */
    const device_clock_t *clock = board_clock_get();
    if (clock == NULL) {
        /* Halt or enter a safe fault state. */
        for (;;) {
        }
    }

    /* 2. Initialize board sensors (ADC temperature, GPIO outputs). */
    const sensors_t *sensors = board_sensors_get();
    if (sensors == NULL) {
        for (;;) {
        }
    }

    /* 3. Initialize board TCP client (W7500P over SPI/UART). */
    const tcp_client_t *client = board_tcp_client_get();
    if (client == NULL) {
        for (;;) {
        }
    }

    /* 4. Wire the application context. */
    app_result_t result = app_init(
        &g_app, (uint16_t)CONFIG_DEVICE_ID, sensors, client, clock);

    if (result != APP_RESULT_OK) {
        /* Misconfiguration: device ID 0 or missing interface function. */
        for (;;) {
        }
    }

    /* 5. Main loop: run forever, reconnecting with backoff on failure. */
    for (;;) {
        result = app_step(&g_app);

        switch (result) {
        case APP_RESULT_TRANSPORT_ERROR:
        case APP_RESULT_BACKOFF:
            /* app_step already waited the backoff delay; just continue. */
            break;
        case APP_RESULT_CYCLE_COMPLETE:
        case APP_RESULT_CONNECTED:
            /* Normal operation; continue immediately. */
            break;
        case APP_RESULT_SENSOR_ERROR:
        case APP_RESULT_CLOCK_ERROR:
        case APP_RESULT_FRAME_ERROR:
            /* Log and continue; the next cycle may succeed. */
            break;
        case APP_RESULT_ARGUMENT:
        default:
            /* Programming error; halt. */
            for (;;) {
            }
        }
    }

    /* Unreachable. */
    return 0;
}
