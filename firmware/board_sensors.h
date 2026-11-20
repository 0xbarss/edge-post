#ifndef EDGE_POST_BOARD_SENSORS_H
#define EDGE_POST_BOARD_SENSORS_H

#include "sensors.h"

/*
 * Board sensor implementation.
 *
 * Adapts the STM32 HAL ADC (temperature channel) and GPIO outputs into the
 * edge-post sensors_t contract. Pin assignments come from board_config.h role
 * macros (BOARD_TEMP_*, BOARD_OUT*) so no literal pins appear here.
 *
 * Include board_config.h before this header.
 */

#ifdef __cplusplus
extern "C" {
#endif

/* Returns a sensors_t configured from the board's role macros. */
const sensors_t *board_sensors_get(void);

#ifdef __cplusplus
}
#endif

#endif /* EDGE_POST_BOARD_SENSORS_H */
