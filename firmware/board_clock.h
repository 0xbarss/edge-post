#ifndef EDGE_POST_BOARD_CLOCK_H
#define EDGE_POST_BOARD_CLOCK_H

#include "clock.h"

/*
 * Board clock implementation.
 *
 * Builds a device_clock_t backed by the STM32 HAL RTC and system tick. The clock
 * reads board_config.h for the RTC source and system clock recorded by CubeMX.
 *
 * Include board_config.h before this header so the role macros are visible.
 */

#ifdef __cplusplus
extern "C" {
#endif

/* Returns a device_clock_t configured from the board's CubeMX clock tree. */
const device_clock_t *board_clock_get(void);

#ifdef __cplusplus
}
#endif

#endif /* EDGE_POST_BOARD_CLOCK_H */
