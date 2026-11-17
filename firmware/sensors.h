#ifndef EDGE_POST_SENSORS_H
#define EDGE_POST_SENSORS_H

#include <stdint.h>

/*
 * Sensor contract used by the application and by host tests. The implementation for the board
 * supplies the function pointers and an opaque context; tests supply fakes.
 */

typedef enum {
    SENSOR_OK = 0,
    SENSOR_ERROR_ARGUMENT,
    SENSOR_ERROR_PIN,
    SENSOR_ERROR_STATE,
    SENSOR_ERROR_RATE,
    SENSOR_ERROR_IO,
} sensor_error_t;

typedef struct {
    void *context;
    /* Writes the current temperature in tenths of a degree Celsius. */
    sensor_error_t (*read_temperature_tenths)(void *context, int16_t *tenths);
    /* Writes the GPIO bitmask, where bit n is the state of pin n. */
    sensor_error_t (*read_gpio_state)(void *context, uint8_t *state);
    /* Drives one pin; pin must be 0-7 and state must be 0 or 1. */
    sensor_error_t (*write_gpio_pin)(void *context, uint8_t pin, uint8_t state);
    /* Changes the sampling interval in seconds; valid values are 1-255. */
    sensor_error_t (*set_sample_rate)(void *context, uint8_t seconds);
    /* Returns the sampling interval in seconds currently in effect. */
    uint8_t (*get_sample_rate)(void *context);
} sensors_t;

#endif
