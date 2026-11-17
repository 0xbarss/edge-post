#include "../app.h"

#include "../config.h"
#include "../frame.h"
#include "fakes.h"
#include "frame_vectors.h"
#include "test_support.h"

#include <string.h>

#define TEST_DEVICE_ID 0x1234u
#define TEST_EPOCH 1794744000u
#define TEST_TEMPERATURE 234
#define TEST_GPIO_STATE 0x05u
#define TEST_SAMPLE_RATE 5u

typedef struct {
    fake_sensors_t sensors;
    fake_client_t client;
    fake_clock_t clock;
    sensors_t sensor_interface;
    tcp_client_t client_interface;
    device_clock_t clock_interface;
    app_context_t context;
} fixture_t;

static void fixture_init(fixture_t *fixture) {
    memset(fixture, 0, sizeof *fixture);

    fake_sensors_init(&fixture->sensors, TEST_SAMPLE_RATE);
    fixture->sensors.temperature_tenths = TEST_TEMPERATURE;
    fixture->sensors.gpio_state = TEST_GPIO_STATE;

    fake_client_init(&fixture->client);
    fixture->client.receive_error = TCP_CLIENT_ERROR_TIMEOUT;

    fake_clock_init(&fixture->clock, TEST_EPOCH);

    fixture->sensor_interface.context = &fixture->sensors;
    fixture->sensor_interface.read_temperature_tenths = fake_read_temperature;
    fixture->sensor_interface.read_gpio_state = fake_read_gpio_state;
    fixture->sensor_interface.write_gpio_pin = fake_write_gpio_pin;
    fixture->sensor_interface.set_sample_rate = fake_set_sample_rate;
    fixture->sensor_interface.get_sample_rate = fake_get_sample_rate;

    fixture->client_interface.context = &fixture->client;
    fixture->client_interface.connect = fake_connect;
    fixture->client_interface.send = fake_send;
    fixture->client_interface.receive = fake_receive;

    fixture->clock_interface.context = &fixture->clock;
    fixture->clock_interface.now_seconds = fake_now_seconds;
    fixture->clock_interface.sleep_ms = fake_sleep_ms;

    CHECK(app_init(&fixture->context, TEST_DEVICE_ID, &fixture->sensor_interface,
                   &fixture->client_interface, &fixture->clock_interface) == APP_RESULT_OK);
}

static void connect_fixture(fixture_t *fixture) {
    CHECK(app_step(&fixture->context) == APP_RESULT_CONNECTED);
    CHECK(fixture->client.connect_calls == 1);
    CHECK(fixture->clock.sleep_calls == 0);
}

static void expect_frame(fixture_t *fixture, const uint8_t *frame, size_t length) {
    memcpy(fixture->client.incoming, frame, length);
    fixture->client.incoming_length = length;
}

static void check_reading(const fixture_t *fixture, size_t index, uint16_t sequence,
                          uint8_t sample_rate) {
    reading_frame_t reading = {0};

    CHECK(index < fixture->client.sent_count);
    CHECK(fixture->client.sent_lengths[index] == FRAME_SIZE_READING);
    CHECK(frame_decode_reading(fixture->client.sent[index], fixture->client.sent_lengths[index],
                               &reading) == FRAME_OK);
    CHECK(reading.device_id == TEST_DEVICE_ID);
    CHECK(reading.sequence == sequence);
    CHECK(reading.timestamp == TEST_EPOCH);
    CHECK(reading.temperature_tenths == TEST_TEMPERATURE);
    CHECK(reading.gpio_state == TEST_GPIO_STATE);
    CHECK(reading.sample_rate == sample_rate);
}

static void check_poll(const fixture_t *fixture, size_t index) {
    CHECK(index < fixture->client.sent_count);
    CHECK(fixture->client.sent_lengths[index] == FRAME_SIZE_POLL);
    CHECK(memcmp(fixture->client.sent[index], POLL_VECTOR, FRAME_SIZE_POLL) == 0);
}

static uint32_t expected_backoff(uint32_t current) {
    if (current >= CONFIG_RECONNECT_MAX_DELAY_MS / 2u) {
        return CONFIG_RECONNECT_MAX_DELAY_MS;
    }

    return current * 2u;
}

static void test_init_rejects_invalid_arguments(void) {
    sensors_t sensors;
    tcp_client_t client;
    device_clock_t clock;
    fixture_t fixture;

    fixture_init(&fixture);
    CHECK(fixture.context.link == APP_LINK_DISCONNECTED);
    CHECK(fixture.context.next_sequence == 0u);
    CHECK(fixture.context.backoff_ms == CONFIG_RECONNECT_INITIAL_DELAY_MS);

    CHECK(app_init(NULL, TEST_DEVICE_ID, &fixture.sensor_interface, &fixture.client_interface,
                   &fixture.clock_interface) == APP_RESULT_ARGUMENT);
    CHECK(app_init(&fixture.context, 0u, &fixture.sensor_interface, &fixture.client_interface,
                   &fixture.clock_interface) == APP_RESULT_ARGUMENT);
    CHECK(app_init(&fixture.context, TEST_DEVICE_ID, NULL, &fixture.client_interface,
                   &fixture.clock_interface) == APP_RESULT_ARGUMENT);
    CHECK(app_init(&fixture.context, TEST_DEVICE_ID, &fixture.sensor_interface, NULL,
                   &fixture.clock_interface) == APP_RESULT_ARGUMENT);
    CHECK(app_init(&fixture.context, TEST_DEVICE_ID, &fixture.sensor_interface,
                   &fixture.client_interface, NULL) == APP_RESULT_ARGUMENT);

    sensors = fixture.sensor_interface;
    sensors.get_sample_rate = NULL;
    CHECK(app_init(&fixture.context, TEST_DEVICE_ID, &sensors, &fixture.client_interface,
                   &fixture.clock_interface) == APP_RESULT_ARGUMENT);

    client = fixture.client_interface;
    client.connect = NULL;
    CHECK(app_init(&fixture.context, TEST_DEVICE_ID, &fixture.sensor_interface, &client,
                   &fixture.clock_interface) == APP_RESULT_ARGUMENT);

    clock = fixture.clock_interface;
    clock.sleep_ms = NULL;
    CHECK(app_init(&fixture.context, TEST_DEVICE_ID, &fixture.sensor_interface,
                   &fixture.client_interface, &clock) == APP_RESULT_ARGUMENT);

    CHECK(app_step(NULL) == APP_RESULT_ARGUMENT);

    fixture.context.client = NULL;
    CHECK(app_step(&fixture.context) == APP_RESULT_ARGUMENT);
}

static void test_connect_success(void) {
    fixture_t fixture;

    fixture_init(&fixture);

    CHECK(app_step(&fixture.context) == APP_RESULT_CONNECTED);
    CHECK(fixture.client.connect_calls == 1);
    CHECK(fixture.clock.sleep_calls == 0);
    CHECK(fixture.context.link == APP_LINK_CONNECTED);
}

static void test_connect_backoff(void) {
    uint32_t expected = CONFIG_RECONNECT_INITIAL_DELAY_MS;
    fixture_t fixture;

    fixture_init(&fixture);
    fixture.client.connect_error = TCP_CLIENT_ERROR_IO;

    for (int attempt = 0; attempt < 6; attempt += 1) {
        CHECK(app_step(&fixture.context) == APP_RESULT_BACKOFF);
        CHECK(fixture.clock.last_sleep_ms == expected);
        expected = expected_backoff(expected);
    }

    CHECK(fixture.client.connect_calls == 6);
    CHECK(fixture.clock.sleep_calls == 6);
    CHECK(fixture.context.link == APP_LINK_DISCONNECTED);

    fixture.client.connect_error = TCP_CLIENT_OK;
    CHECK(app_step(&fixture.context) == APP_RESULT_CONNECTED);
    CHECK(fixture.client.connect_calls == 7);
    CHECK(fixture.clock.sleep_calls == 6);
    CHECK(fixture.context.backoff_ms == CONFIG_RECONNECT_INITIAL_DELAY_MS);
}

static void test_cycle_sends_reading_and_poll(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    connect_fixture(&fixture);

    CHECK(app_step(&fixture.context) == APP_RESULT_CYCLE_COMPLETE);

    CHECK(fixture.client.sent_count == 2u);
    check_reading(&fixture, 0u, 0u, TEST_SAMPLE_RATE);
    check_poll(&fixture, 1u);

    CHECK(fixture.sensors.read_temperature_calls == 1);
    CHECK(fixture.sensors.read_gpio_calls == 1);
    CHECK(fixture.context.next_sequence == 1u);
    CHECK(fixture.clock.sleep_calls == 1);
    CHECK(fixture.clock.last_sleep_ms == TEST_SAMPLE_RATE * 1000u);
}

static void test_sequence_wraps(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    connect_fixture(&fixture);
    fixture.context.next_sequence = 65535u;

    CHECK(app_step(&fixture.context) == APP_RESULT_CYCLE_COMPLETE);
    check_reading(&fixture, 0u, 65535u, TEST_SAMPLE_RATE);
    CHECK(fixture.context.next_sequence == 0u);

    CHECK(app_step(&fixture.context) == APP_RESULT_CYCLE_COMPLETE);
    check_reading(&fixture, 2u, 0u, TEST_SAMPLE_RATE);
}

static void test_sample_rate_command_updates_interval(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    connect_fixture(&fixture);

    expect_frame(&fixture, COMMAND_SET_RATE_VECTOR, sizeof COMMAND_SET_RATE_VECTOR);
    fixture.client.receive_error = TCP_CLIENT_OK;

    CHECK(app_step(&fixture.context) == APP_RESULT_CYCLE_COMPLETE);
    CHECK(fixture.sensors.set_rate_calls == 1);
    CHECK(fixture.sensors.sample_rate == 10u);
    CHECK(fixture.client.sent_count == 3u);
    check_reading(&fixture, 0u, 0u, TEST_SAMPLE_RATE);
    check_poll(&fixture, 1u);
    CHECK(fixture.clock.last_sleep_ms == 10000u);

    fixture.client.receive_error = TCP_CLIENT_ERROR_TIMEOUT;

    CHECK(app_step(&fixture.context) == APP_RESULT_CYCLE_COMPLETE);
    CHECK(fixture.client.sent_count == 5u);
    check_reading(&fixture, 3u, 1u, 10u);
    CHECK(fixture.clock.last_sleep_ms == 10000u);
}

static void test_sensor_read_errors_skip_frames(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    connect_fixture(&fixture);
    fixture.sensors.read_temperature_error = SENSOR_ERROR_IO;

    CHECK(app_step(&fixture.context) == APP_RESULT_SENSOR_ERROR);
    CHECK(fixture.client.send_calls == 0);
    CHECK(fixture.client.sent_count == 0u);
    CHECK(fixture.context.next_sequence == 0u);
    CHECK(fixture.clock.last_sleep_ms == TEST_SAMPLE_RATE * 1000u);

    fixture_init(&fixture);
    connect_fixture(&fixture);
    fixture.sensors.read_gpio_error = SENSOR_ERROR_IO;

    CHECK(app_step(&fixture.context) == APP_RESULT_SENSOR_ERROR);
    CHECK(fixture.client.send_calls == 0);
    CHECK(fixture.client.sent_count == 0u);
}

static void test_unusable_sample_rate_skips_frame(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    connect_fixture(&fixture);
    fixture.sensors.sample_rate = 0u;

    CHECK(app_step(&fixture.context) == APP_RESULT_SENSOR_ERROR);
    CHECK(fixture.client.send_calls == 0);
    CHECK(fixture.clock.last_sleep_ms == CONFIG_SAMPLE_RATE_SECONDS * 1000u);
}

static void test_invalid_reading_skips_frame(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    connect_fixture(&fixture);
    fixture.sensors.temperature_tenths = 2000;

    CHECK(app_step(&fixture.context) == APP_RESULT_FRAME_ERROR);
    CHECK(fixture.client.send_calls == 0);
    CHECK(fixture.context.next_sequence == 0u);
    CHECK(fixture.clock.last_sleep_ms == TEST_SAMPLE_RATE * 1000u);
}

static void test_unset_clock_skips_frame(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    connect_fixture(&fixture);
    fixture.clock.epoch_seconds = 0u;

    CHECK(app_step(&fixture.context) == APP_RESULT_CLOCK_ERROR);
    CHECK(fixture.client.send_calls == 0);
    CHECK(fixture.context.next_sequence == 0u);
}

static void test_reading_send_failure_disconnects(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    connect_fixture(&fixture);
    fixture.client.fail_send_call = 1;

    CHECK(app_step(&fixture.context) == APP_RESULT_TRANSPORT_ERROR);
    CHECK(fixture.context.link == APP_LINK_DISCONNECTED);
    CHECK(fixture.client.sent_count == 0u);
    CHECK(fixture.context.next_sequence == 0u);
    CHECK(fixture.clock.last_sleep_ms == CONFIG_RECONNECT_INITIAL_DELAY_MS);

    fixture.client.connect_error = TCP_CLIENT_ERROR_IO;
    CHECK(app_step(&fixture.context) == APP_RESULT_BACKOFF);
    CHECK(fixture.clock.last_sleep_ms == expected_backoff(CONFIG_RECONNECT_INITIAL_DELAY_MS));

    fixture.client.connect_error = TCP_CLIENT_OK;
    CHECK(app_step(&fixture.context) == APP_RESULT_CONNECTED);
    CHECK(fixture.client.connect_calls == 3);
}

static void test_poll_send_failure_disconnects(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    connect_fixture(&fixture);
    fixture.client.fail_send_call = 2;

    CHECK(app_step(&fixture.context) == APP_RESULT_TRANSPORT_ERROR);
    CHECK(fixture.client.sent_count == 1u);
    check_reading(&fixture, 0u, 0u, TEST_SAMPLE_RATE);
    CHECK(fixture.context.next_sequence == 1u);
    CHECK(fixture.context.link == APP_LINK_DISCONNECTED);
}

static void test_command_receive_failure_disconnects(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    connect_fixture(&fixture);
    fixture.client.receive_error = TCP_CLIENT_ERROR_DISCONNECTED;

    CHECK(app_step(&fixture.context) == APP_RESULT_TRANSPORT_ERROR);
    CHECK(fixture.client.sent_count == 2u);
    check_reading(&fixture, 0u, 0u, TEST_SAMPLE_RATE);
    check_poll(&fixture, 1u);
    CHECK(fixture.context.link == APP_LINK_DISCONNECTED);

    fixture.client.connect_error = TCP_CLIENT_OK;
    CHECK(app_step(&fixture.context) == APP_RESULT_CONNECTED);
}

static void expect_command_not_fatal(const uint8_t *frame, size_t length,
                                     tcp_client_error_t receive_error) {
    fixture_t fixture;

    fixture_init(&fixture);
    connect_fixture(&fixture);
    fixture.client.receive_error = receive_error;

    if (frame != NULL) {
        expect_frame(&fixture, frame, length);
    }

    CHECK(app_step(&fixture.context) == APP_RESULT_CYCLE_COMPLETE);
    CHECK(fixture.client.sent_count >= 1u);
    CHECK(fixture.context.link == APP_LINK_CONNECTED);
    CHECK(fixture.clock.sleep_calls == 1);
    CHECK(fixture.clock.last_sleep_ms == TEST_SAMPLE_RATE * 1000u);
}

static void test_command_results_are_not_fatal(void) {
    uint8_t frame[FRAME_SIZE_COMMAND];

    expect_command_not_fatal(COMMAND_NONE_VECTOR, sizeof COMMAND_NONE_VECTOR, TCP_CLIENT_OK);
    expect_command_not_fatal(NULL, 0u, TCP_CLIENT_ERROR_TIMEOUT);

    memcpy(frame, COMMAND_TOGGLE_VECTOR, sizeof frame);
    frame[9] = 9u;
    seal_frame(frame, FRAME_SIZE_COMMAND);
    expect_command_not_fatal(frame, sizeof frame, TCP_CLIENT_OK);

    memcpy(frame, COMMAND_SET_RATE_VECTOR, sizeof frame);
    frame[8] = 9u;
    seal_frame(frame, FRAME_SIZE_COMMAND);
    expect_command_not_fatal(frame, sizeof frame, TCP_CLIENT_OK);

    memcpy(frame, COMMAND_TOGGLE_VECTOR, sizeof frame);
    frame[FRAME_SIZE_COMMAND - 1] ^= 0xFFu;
    expect_command_not_fatal(frame, sizeof frame, TCP_CLIENT_OK);
}

static void test_result_names(void) {
    CHECK(strcmp(app_result_name(APP_RESULT_OK), "ok") == 0);
    CHECK(strcmp(app_result_name(APP_RESULT_CONNECTED), "connected") == 0);
    CHECK(strcmp(app_result_name(APP_RESULT_CYCLE_COMPLETE), "cycle-complete") == 0);
    CHECK(strcmp(app_result_name(APP_RESULT_SENSOR_ERROR), "sensor-error") == 0);
    CHECK(strcmp(app_result_name(APP_RESULT_CLOCK_ERROR), "clock-error") == 0);
    CHECK(strcmp(app_result_name(APP_RESULT_FRAME_ERROR), "frame-error") == 0);
    CHECK(strcmp(app_result_name(APP_RESULT_TRANSPORT_ERROR), "transport-error") == 0);
    CHECK(strcmp(app_result_name(APP_RESULT_BACKOFF), "backoff") == 0);
    CHECK(strcmp(app_result_name(APP_RESULT_ARGUMENT), "argument") == 0);
}

int main(void) {
    test_init_rejects_invalid_arguments();
    test_connect_success();
    test_connect_backoff();
    test_cycle_sends_reading_and_poll();
    test_sequence_wraps();
    test_sample_rate_command_updates_interval();
    test_sensor_read_errors_skip_frames();
    test_unusable_sample_rate_skips_frame();
    test_invalid_reading_skips_frame();
    test_unset_clock_skips_frame();
    test_reading_send_failure_disconnects();
    test_poll_send_failure_disconnects();
    test_command_receive_failure_disconnects();
    test_command_results_are_not_fatal();
    test_result_names();

    return test_report("application loop");
}
