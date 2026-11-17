#ifndef EDGE_POST_APP_H
#define EDGE_POST_APP_H

#include <stdint.h>

#include "clock.h"
#include "sensors.h"
#include "tcp_client.h"

typedef enum {
    APP_RESULT_OK = 0,
    /* The connection is open and the next step samples the sensors. */
    APP_RESULT_CONNECTED,
    /* One reading and one command poll completed. */
    APP_RESULT_CYCLE_COMPLETE,
    /* A sensor read or the current sample rate was unusable; no frame was sent. */
    APP_RESULT_SENSOR_ERROR,
    /* The clock has not been set; the frame has no usable timestamp. */
    APP_RESULT_CLOCK_ERROR,
    /* The sampled values did not form a valid reading frame. */
    APP_RESULT_FRAME_ERROR,
    /* A send or receive failed; the loop is disconnected and backing off. */
    APP_RESULT_TRANSPORT_ERROR,
    /* The connection attempt failed; the loop is waiting before the next attempt. */
    APP_RESULT_BACKOFF,
    /* The context or one of its interfaces is missing. */
    APP_RESULT_ARGUMENT,
} app_result_t;

typedef enum {
    APP_LINK_DISCONNECTED = 0,
    APP_LINK_CONNECTED,
} app_link_state_t;

typedef struct {
    uint16_t device_id;
    const sensors_t *sensors;
    const tcp_client_t *client;
    const device_clock_t *clock;
    /* Internal state; only app_init and app_step write these fields. */
    app_link_state_t link;
    uint16_t next_sequence;
    uint32_t backoff_ms;
} app_context_t;

/* Wires the interfaces into a disconnected context. Returns OK or ARGUMENT. */
app_result_t app_init(app_context_t *context, uint16_t device_id, const sensors_t *sensors,
                      const tcp_client_t *client, const device_clock_t *clock);

/*
 * Advances the loop by one step. While disconnected it attempts one connection and waits the
 * current backoff delay on failure. While connected it reads the temperature and GPIO state,
 * sends one reading with the sample rate currently reported by the sensors, polls for one
 * command, and waits for the sampling interval. A transport failure disconnects and waits the
 * current backoff delay before the next attempt.
 */
app_result_t app_step(app_context_t *context);

/* Returns a stable name for a result code, suitable for logging. */
const char *app_result_name(app_result_t result);

#endif
