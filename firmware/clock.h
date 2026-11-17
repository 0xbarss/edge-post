#ifndef EDGE_POST_CLOCK_H
#define EDGE_POST_CLOCK_H

#include <stdint.h>

/*
 * Time contract used by the application and by host tests. The implementation supplies the
 * function pointers and an opaque context; tests supply fakes.
 */

typedef struct {
    void *context;
    /* Returns the current Unix epoch in seconds, or 0 when the clock has not been set. */
    uint32_t (*now_seconds)(void *context);
    /* Blocks for at least delay_ms; callers pass a positive delay. */
    void (*sleep_ms)(void *context, uint32_t delay_ms);
} device_clock_t;

#endif
