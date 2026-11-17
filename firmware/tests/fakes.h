#ifndef EDGE_POST_TEST_FAKES_H
#define EDGE_POST_TEST_FAKES_H

#include "../clock.h"
#include "../frame.h"
#include "../sensors.h"
#include "../tcp_client.h"

#include <stddef.h>
#include <stdint.h>
#include <string.h>

/*
 * Reusable implementations of the device interfaces. Every fake records the calls it receives
 * and lets a test inject the error each call should return.
 */

#define FAKE_MAX_CAPTURED_SENDS 8

typedef struct {
    int16_t temperature_tenths;
    uint8_t gpio_state;
    uint8_t sample_rate;
    sensor_error_t read_temperature_error;
    sensor_error_t read_gpio_error;
    sensor_error_t write_error;
    sensor_error_t set_rate_error;
    int read_temperature_calls;
    int read_gpio_calls;
    int write_calls;
    uint8_t last_pin;
    uint8_t last_state;
    int set_rate_calls;
    uint8_t last_rate;
} fake_sensors_t;

typedef struct {
    uint8_t incoming[FRAME_MAX_SIZE];
    size_t incoming_length;
    tcp_client_error_t connect_error;
    tcp_client_error_t receive_error;
    int fail_send_call;
    int connect_calls;
    int send_calls;
    int receive_calls;
    size_t sent_count;
    uint8_t sent[FAKE_MAX_CAPTURED_SENDS][FRAME_MAX_SIZE];
    size_t sent_lengths[FAKE_MAX_CAPTURED_SENDS];
} fake_client_t;

typedef struct {
    uint32_t epoch_seconds;
    int sleep_calls;
    uint32_t total_sleep_ms;
    uint32_t last_sleep_ms;
} fake_clock_t;

static inline void fake_sensors_init(fake_sensors_t *fake, uint8_t sample_rate) {
    memset(fake, 0, sizeof *fake);
    fake->sample_rate = sample_rate;
}

static inline void fake_client_init(fake_client_t *fake) {
    memset(fake, 0, sizeof *fake);
}

static inline void fake_clock_init(fake_clock_t *fake, uint32_t epoch_seconds) {
    memset(fake, 0, sizeof *fake);
    fake->epoch_seconds = epoch_seconds;
}

static inline sensor_error_t fake_read_temperature(void *context, int16_t *tenths) {
    fake_sensors_t *fake = (fake_sensors_t *)context;

    if (fake == NULL || tenths == NULL) {
        return SENSOR_ERROR_ARGUMENT;
    }

    fake->read_temperature_calls += 1;

    if (fake->read_temperature_error != SENSOR_OK) {
        return fake->read_temperature_error;
    }

    *tenths = fake->temperature_tenths;
    return SENSOR_OK;
}

static inline sensor_error_t fake_read_gpio_state(void *context, uint8_t *state) {
    fake_sensors_t *fake = (fake_sensors_t *)context;

    if (fake == NULL || state == NULL) {
        return SENSOR_ERROR_ARGUMENT;
    }

    fake->read_gpio_calls += 1;

    if (fake->read_gpio_error != SENSOR_OK) {
        return fake->read_gpio_error;
    }

    *state = fake->gpio_state;
    return SENSOR_OK;
}

static inline sensor_error_t fake_write_gpio_pin(void *context, uint8_t pin, uint8_t state) {
    fake_sensors_t *fake = (fake_sensors_t *)context;

    if (fake == NULL) {
        return SENSOR_ERROR_ARGUMENT;
    }

    if (pin > 7u) {
        return SENSOR_ERROR_PIN;
    }

    if (state > 1u) {
        return SENSOR_ERROR_STATE;
    }

    fake->write_calls += 1;
    fake->last_pin = pin;
    fake->last_state = state;

    return fake->write_error;
}

static inline sensor_error_t fake_set_sample_rate(void *context, uint8_t seconds) {
    fake_sensors_t *fake = (fake_sensors_t *)context;

    if (fake == NULL) {
        return SENSOR_ERROR_ARGUMENT;
    }

    if (seconds == 0u) {
        return SENSOR_ERROR_RATE;
    }

    fake->set_rate_calls += 1;
    fake->last_rate = seconds;

    if (fake->set_rate_error == SENSOR_OK) {
        fake->sample_rate = seconds;
    }

    return fake->set_rate_error;
}

static inline uint8_t fake_get_sample_rate(void *context) {
    const fake_sensors_t *fake = (const fake_sensors_t *)context;

    if (fake == NULL) {
        return 0u;
    }

    return fake->sample_rate;
}

static inline tcp_client_error_t fake_connect(void *context) {
    fake_client_t *fake = (fake_client_t *)context;

    if (fake == NULL) {
        return TCP_CLIENT_ERROR_ARGUMENT;
    }

    fake->connect_calls += 1;
    return fake->connect_error;
}

static inline tcp_client_error_t fake_send(void *context, const uint8_t *bytes, size_t length) {
    fake_client_t *fake = (fake_client_t *)context;

    if (fake == NULL || bytes == NULL || length > FRAME_MAX_SIZE) {
        return TCP_CLIENT_ERROR_ARGUMENT;
    }

    fake->send_calls += 1;

    if (fake->fail_send_call != 0 && fake->send_calls == fake->fail_send_call) {
        return TCP_CLIENT_ERROR_IO;
    }

    if (fake->sent_count < FAKE_MAX_CAPTURED_SENDS) {
        memcpy(fake->sent[fake->sent_count], bytes, length);
        fake->sent_lengths[fake->sent_count] = length;
        fake->sent_count += 1;
    }

    return TCP_CLIENT_OK;
}

static inline tcp_client_error_t fake_receive(void *context, uint8_t *buffer, size_t capacity,
                                              size_t *length, uint32_t timeout_ms) {
    fake_client_t *fake = (fake_client_t *)context;

    (void)timeout_ms;

    if (fake == NULL || buffer == NULL || length == NULL) {
        return TCP_CLIENT_ERROR_ARGUMENT;
    }

    fake->receive_calls += 1;

    if (fake->receive_error != TCP_CLIENT_OK) {
        return fake->receive_error;
    }

    if (capacity < fake->incoming_length) {
        return TCP_CLIENT_ERROR_ARGUMENT;
    }

    memcpy(buffer, fake->incoming, fake->incoming_length);
    *length = fake->incoming_length;

    return TCP_CLIENT_OK;
}

static inline uint32_t fake_now_seconds(void *context) {
    const fake_clock_t *fake = (const fake_clock_t *)context;

    if (fake == NULL) {
        return 0u;
    }

    return fake->epoch_seconds;
}

static inline void fake_sleep_ms(void *context, uint32_t delay_ms) {
    fake_clock_t *fake = (fake_clock_t *)context;

    if (fake == NULL) {
        return;
    }

    fake->sleep_calls += 1;
    fake->last_sleep_ms = delay_ms;
    fake->total_sleep_ms += delay_ms;
}

#endif
