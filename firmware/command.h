#ifndef EDGE_POST_COMMAND_H
#define EDGE_POST_COMMAND_H

#include <stdint.h>

#include "sensors.h"
#include "tcp_client.h"

typedef enum {
    /* The backend answered the poll with a type 0 frame. */
    COMMAND_RESULT_NONE = 0,
    /* The command was applied and acknowledged as executed. */
    COMMAND_RESULT_EXECUTED,
    /* The command was not applied and was acknowledged as rejected. */
    COMMAND_RESULT_REJECTED,
    /* The command type is unknown and was acknowledged as unsupported. */
    COMMAND_RESULT_UNSUPPORTED,
    /* The frame was dropped without an acknowledgement. */
    COMMAND_RESULT_IGNORED,
    /* No command frame arrived within the timeout; retry after the next reading. */
    COMMAND_RESULT_TIMEOUT,
    /* A send or receive failed; the caller should reconnect. */
    COMMAND_RESULT_TRANSPORT_ERROR,
    /* The context or one of its interfaces is missing. */
    COMMAND_RESULT_ARGUMENT,
} command_result_t;

typedef struct {
    uint16_t device_id;
    const sensors_t *sensors;
    const tcp_client_t *client;
} command_context_t;

/*
 * Sends one command poll and handles the answer. A frame addressed to another device, a frame
 * that fails its checksum, and a known type with an unusable command ID are dropped without an
 * acknowledgement. A known type with invalid parameters or a failed apply is acknowledged as
 * rejected; an unknown type is acknowledged as unsupported.
 */
command_result_t command_poll(const command_context_t *context, uint32_t timeout_ms);

/* Returns a stable name for a result code, suitable for logging. */
const char *command_result_name(command_result_t result);

#endif
