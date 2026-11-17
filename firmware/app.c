#include "app.h"

#include "command.h"
#include "config.h"
#include "frame.h"

#include <stddef.h>

static int interfaces_valid(const sensors_t *sensors, const tcp_client_t *client,
                            const device_clock_t *clock) {
    return sensors != NULL && sensors->read_temperature_tenths != NULL &&
           sensors->read_gpio_state != NULL && sensors->write_gpio_pin != NULL &&
           sensors->set_sample_rate != NULL && sensors->get_sample_rate != NULL && client != NULL &&
           client->connect != NULL && client->send != NULL && client->receive != NULL &&
           clock != NULL && clock->now_seconds != NULL && clock->sleep_ms != NULL;
}

static int context_is_valid(const app_context_t *context) {
    return context != NULL && context->device_id != 0 &&
           interfaces_valid(context->sensors, context->client, context->clock);
}

static void wait_ms(const app_context_t *context, uint32_t delay_ms) {
    context->clock->sleep_ms(context->clock->context, delay_ms);
}

static uint32_t take_backoff_delay(app_context_t *context) {
    uint32_t delay = context->backoff_ms;

    if (delay >= CONFIG_RECONNECT_MAX_DELAY_MS / 2u) {
        context->backoff_ms = CONFIG_RECONNECT_MAX_DELAY_MS;
    } else {
        context->backoff_ms = delay * 2u;
    }

    return delay;
}

static uint32_t sampling_interval_ms(const app_context_t *context) {
    uint8_t seconds = context->sensors->get_sample_rate(context->sensors->context);

    if (seconds == 0u) {
        seconds = CONFIG_SAMPLE_RATE_SECONDS;
    }

    return (uint32_t)seconds * 1000u;
}

static app_result_t sample_and_poll(app_context_t *context) {
    int16_t temperature_tenths = 0;
    uint8_t gpio_state = 0;
    uint8_t sample_rate = 0;
    uint32_t timestamp = 0;
    uint8_t buffer[FRAME_SIZE_READING] = {0};
    reading_frame_t reading = {0};

    if (context->sensors->read_temperature_tenths(context->sensors->context, &temperature_tenths) !=
        SENSOR_OK) {
        return APP_RESULT_SENSOR_ERROR;
    }

    if (context->sensors->read_gpio_state(context->sensors->context, &gpio_state) != SENSOR_OK) {
        return APP_RESULT_SENSOR_ERROR;
    }

    sample_rate = context->sensors->get_sample_rate(context->sensors->context);
    if (sample_rate == 0u) {
        return APP_RESULT_SENSOR_ERROR;
    }

    timestamp = context->clock->now_seconds(context->clock->context);
    if (timestamp == 0u) {
        return APP_RESULT_CLOCK_ERROR;
    }

    reading.device_id = context->device_id;
    reading.sequence = context->next_sequence;
    reading.timestamp = timestamp;
    reading.temperature_tenths = temperature_tenths;
    reading.gpio_state = gpio_state;
    reading.sample_rate = sample_rate;

    if (frame_encode_reading(&reading, buffer, sizeof buffer) != FRAME_OK) {
        return APP_RESULT_FRAME_ERROR;
    }

    if (context->client->send(context->client->context, buffer, FRAME_SIZE_READING) !=
        TCP_CLIENT_OK) {
        return APP_RESULT_TRANSPORT_ERROR;
    }

    context->next_sequence = (uint16_t)(context->next_sequence + 1u);

    command_context_t command = {
        .device_id = context->device_id,
        .sensors = context->sensors,
        .client = context->client,
    };
    command_result_t result = command_poll(&command, CONFIG_POLL_TIMEOUT_MS);

    if (result == COMMAND_RESULT_TRANSPORT_ERROR) {
        return APP_RESULT_TRANSPORT_ERROR;
    }

    if (result == COMMAND_RESULT_ARGUMENT) {
        return APP_RESULT_ARGUMENT;
    }

    return APP_RESULT_CYCLE_COMPLETE;
}

static app_result_t step_disconnected(app_context_t *context) {
    if (context->client->connect(context->client->context) == TCP_CLIENT_OK) {
        context->link = APP_LINK_CONNECTED;
        context->backoff_ms = CONFIG_RECONNECT_INITIAL_DELAY_MS;
        return APP_RESULT_CONNECTED;
    }

    wait_ms(context, take_backoff_delay(context));
    return APP_RESULT_BACKOFF;
}

static app_result_t step_connected(app_context_t *context) {
    app_result_t result = sample_and_poll(context);

    if (result == APP_RESULT_TRANSPORT_ERROR) {
        context->link = APP_LINK_DISCONNECTED;
        wait_ms(context, take_backoff_delay(context));
        return result;
    }

    if (result == APP_RESULT_ARGUMENT) {
        return result;
    }

    wait_ms(context, sampling_interval_ms(context));
    return result;
}

app_result_t app_init(app_context_t *context, uint16_t device_id, const sensors_t *sensors,
                      const tcp_client_t *client, const device_clock_t *clock) {
    if (context == NULL || device_id == 0 || !interfaces_valid(sensors, client, clock)) {
        return APP_RESULT_ARGUMENT;
    }

    context->device_id = device_id;
    context->sensors = sensors;
    context->client = client;
    context->clock = clock;
    context->link = APP_LINK_DISCONNECTED;
    context->next_sequence = 0;
    context->backoff_ms = CONFIG_RECONNECT_INITIAL_DELAY_MS;

    return APP_RESULT_OK;
}

app_result_t app_step(app_context_t *context) {
    if (!context_is_valid(context)) {
        return APP_RESULT_ARGUMENT;
    }

    switch (context->link) {
    case APP_LINK_DISCONNECTED:
        return step_disconnected(context);
    case APP_LINK_CONNECTED:
        return step_connected(context);
    }

    return APP_RESULT_ARGUMENT;
}

const char *app_result_name(app_result_t result) {
    switch (result) {
    case APP_RESULT_OK:
        return "ok";
    case APP_RESULT_CONNECTED:
        return "connected";
    case APP_RESULT_CYCLE_COMPLETE:
        return "cycle-complete";
    case APP_RESULT_SENSOR_ERROR:
        return "sensor-error";
    case APP_RESULT_CLOCK_ERROR:
        return "clock-error";
    case APP_RESULT_FRAME_ERROR:
        return "frame-error";
    case APP_RESULT_TRANSPORT_ERROR:
        return "transport-error";
    case APP_RESULT_BACKOFF:
        return "backoff";
    case APP_RESULT_ARGUMENT:
        return "argument";
    }

    return "unknown";
}
