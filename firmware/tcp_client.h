#ifndef EDGE_POST_TCP_CLIENT_H
#define EDGE_POST_TCP_CLIENT_H

#include <stddef.h>
#include <stdint.h>

/*
 * Transport contract used by the application and by host tests. The implementation owns the
 * connection and the receive buffer; tests supply fakes.
 */

typedef enum {
    TCP_CLIENT_OK = 0,
    TCP_CLIENT_ERROR_ARGUMENT,
    TCP_CLIENT_ERROR_TIMEOUT,
    TCP_CLIENT_ERROR_DISCONNECTED,
    TCP_CLIENT_ERROR_IO,
} tcp_client_error_t;

typedef struct {
    void *context;
    /* Sends every byte or fails; a partial send is reported as an I/O error. */
    tcp_client_error_t (*send)(void *context, const uint8_t *bytes, size_t length);
    /*
     * Waits up to timeout_ms for one complete frame, copies it into the buffer, and reports its
     * length. Partial frames stay buffered inside the implementation. Returns
     * TCP_CLIENT_ERROR_TIMEOUT when no complete frame arrives in time.
     */
    tcp_client_error_t (*receive)(void *context, uint8_t *buffer, size_t capacity, size_t *length,
                                  uint32_t timeout_ms);
} tcp_client_t;

#endif
