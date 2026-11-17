#include "../command.h"

#include "../config.h"
#include "../frame.h"
#include "fakes.h"
#include "frame_vectors.h"
#include "test_support.h"

#include <string.h>

#define TEST_DEVICE_ID 0x1234u
#define TEST_COMMAND_ID 42u
#define TEST_POLL_TIMEOUT_MS 100u

typedef struct {
    fake_sensors_t sensors;
    fake_client_t client;
    sensors_t sensor_interface;
    tcp_client_t client_interface;
    command_context_t context;
} fixture_t;

static void fixture_init(fixture_t *fixture) {
    memset(fixture, 0, sizeof *fixture);

    fake_sensors_init(&fixture->sensors, 5u);
    fake_client_init(&fixture->client);

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

    fixture->context.device_id = TEST_DEVICE_ID;
    fixture->context.sensors = &fixture->sensor_interface;
    fixture->context.client = &fixture->client_interface;
}

static void expect_frame(fixture_t *fixture, const uint8_t *frame, size_t length) {
    memcpy(fixture->client.incoming, frame, length);
    fixture->client.incoming_length = length;
}

static void check_poll_sent(const fixture_t *fixture) {
    CHECK(fixture->client.sent_count >= 1u);
    CHECK(fixture->client.sent_lengths[0] == FRAME_SIZE_POLL);
    CHECK(memcmp(fixture->client.sent[0], POLL_VECTOR, FRAME_SIZE_POLL) == 0);
}

static void test_set_sample_rate(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    expect_frame(&fixture, COMMAND_SET_RATE_VECTOR, sizeof COMMAND_SET_RATE_VECTOR);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_EXECUTED);
    CHECK(fixture.client.receive_calls == 1);
    CHECK(fixture.client.send_calls == 2);
    check_poll_sent(&fixture);

    CHECK(fixture.sensors.set_rate_calls == 1);
    CHECK(fixture.sensors.last_rate == 10u);
    CHECK(fixture.sensors.sample_rate == 10u);
    CHECK(fixture.sensors.write_calls == 0);

    CHECK(fixture.client.sent_count == 2u);
    CHECK(fixture.client.sent_lengths[1] == FRAME_SIZE_ACK);
    CHECK(memcmp(fixture.client.sent[1], ACK_EXECUTED_VECTOR, FRAME_SIZE_ACK) == 0);
}

static void test_toggle_gpio(void) {
    ack_frame_t ack = {0};
    fixture_t fixture;

    fixture_init(&fixture);
    expect_frame(&fixture, COMMAND_TOGGLE_VECTOR, sizeof COMMAND_TOGGLE_VECTOR);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_EXECUTED);
    check_poll_sent(&fixture);

    CHECK(fixture.sensors.write_calls == 1);
    CHECK(fixture.sensors.last_pin == 3u);
    CHECK(fixture.sensors.last_state == 1u);
    CHECK(fixture.sensors.set_rate_calls == 0);

    CHECK(fixture.client.sent_count == 2u);
    CHECK(fixture.client.sent_lengths[1] == FRAME_SIZE_ACK);
    CHECK(frame_decode_ack(fixture.client.sent[1], fixture.client.sent_lengths[1], &ack) ==
          FRAME_OK);
    CHECK(ack.device_id == TEST_DEVICE_ID);
    CHECK(ack.command_id == 43u);
    CHECK(ack.status == FRAME_ACK_EXECUTED);
}

static void test_no_command(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    expect_frame(&fixture, COMMAND_NONE_VECTOR, sizeof COMMAND_NONE_VECTOR);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_NONE);
    check_poll_sent(&fixture);

    CHECK(fixture.sensors.write_calls == 0);
    CHECK(fixture.sensors.set_rate_calls == 0);
    CHECK(fixture.client.sent_count == 1u);
}

static void test_rejected_parameters(void) {
    uint8_t frame[FRAME_SIZE_COMMAND];
    fixture_t fixture;

    fixture_init(&fixture);
    memcpy(frame, COMMAND_TOGGLE_VECTOR, sizeof frame);
    frame[9] = 9u;
    seal_frame(frame, FRAME_SIZE_COMMAND);
    expect_frame(&fixture, frame, sizeof frame);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_REJECTED);
    CHECK(fixture.sensors.write_calls == 0);
    CHECK(fixture.client.sent_count == 2u);
    CHECK(memcmp(fixture.client.sent[1], ACK_REJECTED_VECTOR, FRAME_SIZE_ACK) == 0);
}

static void test_rejected_state(void) {
    uint8_t frame[FRAME_SIZE_COMMAND];
    fixture_t fixture;

    fixture_init(&fixture);
    memcpy(frame, COMMAND_TOGGLE_VECTOR, sizeof frame);
    frame[10] = 2u;
    seal_frame(frame, FRAME_SIZE_COMMAND);
    expect_frame(&fixture, frame, sizeof frame);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_REJECTED);
    CHECK(fixture.sensors.write_calls == 0);
    CHECK(fixture.client.sent_count == 2u);
    CHECK(memcmp(fixture.client.sent[1], ACK_REJECTED_VECTOR, FRAME_SIZE_ACK) == 0);
}

static void test_unknown_type(void) {
    ack_frame_t ack = {0};
    uint8_t frame[FRAME_SIZE_COMMAND];
    fixture_t fixture;

    fixture_init(&fixture);
    memcpy(frame, COMMAND_SET_RATE_VECTOR, sizeof frame);
    frame[8] = 9u;
    seal_frame(frame, FRAME_SIZE_COMMAND);
    expect_frame(&fixture, frame, sizeof frame);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_UNSUPPORTED);
    CHECK(fixture.sensors.set_rate_calls == 0);
    CHECK(fixture.sensors.write_calls == 0);
    CHECK(fixture.client.sent_count == 2u);

    CHECK(frame_decode_ack(fixture.client.sent[1], fixture.client.sent_lengths[1], &ack) ==
          FRAME_OK);
    CHECK(ack.device_id == TEST_DEVICE_ID);
    CHECK(ack.command_id == TEST_COMMAND_ID);
    CHECK(ack.status == FRAME_ACK_UNSUPPORTED);
}

static void test_other_device_ignored(void) {
    uint8_t frame[FRAME_SIZE_COMMAND];
    fixture_t fixture;

    fixture_init(&fixture);
    memcpy(frame, COMMAND_TOGGLE_VECTOR, sizeof frame);
    frame[2] = 0x99u;
    frame[3] = 0x99u;
    seal_frame(frame, FRAME_SIZE_COMMAND);
    expect_frame(&fixture, frame, sizeof frame);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_IGNORED);
    CHECK(fixture.sensors.write_calls == 0);
    CHECK(fixture.client.sent_count == 1u);
}

static void test_bad_crc_ignored(void) {
    uint8_t frame[FRAME_SIZE_COMMAND];
    fixture_t fixture;

    fixture_init(&fixture);
    memcpy(frame, COMMAND_TOGGLE_VECTOR, sizeof frame);
    frame[FRAME_SIZE_COMMAND - 1] ^= 0xFFu;
    expect_frame(&fixture, frame, sizeof frame);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_IGNORED);
    CHECK(fixture.sensors.write_calls == 0);
    CHECK(fixture.client.sent_count == 1u);
}

static void test_bad_magic_ignored(void) {
    uint8_t frame[FRAME_SIZE_COMMAND];
    fixture_t fixture;

    fixture_init(&fixture);
    memcpy(frame, COMMAND_TOGGLE_VECTOR, sizeof frame);
    frame[1] = 0x50u;
    seal_frame(frame, FRAME_SIZE_COMMAND);
    expect_frame(&fixture, frame, sizeof frame);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_IGNORED);
    CHECK(fixture.sensors.write_calls == 0);
    CHECK(fixture.client.sent_count == 1u);
}

static void test_wrong_length_ignored(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    expect_frame(&fixture, READING_VECTOR, sizeof READING_VECTOR);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_IGNORED);
    CHECK(fixture.client.sent_count == 1u);
}

static void test_empty_command_id_ignored(void) {
    uint8_t frame[FRAME_SIZE_COMMAND];
    fixture_t fixture;

    fixture_init(&fixture);
    memcpy(frame, COMMAND_TOGGLE_VECTOR, sizeof frame);
    frame[4] = 0u;
    frame[5] = 0u;
    frame[6] = 0u;
    frame[7] = 0u;
    seal_frame(frame, FRAME_SIZE_COMMAND);
    expect_frame(&fixture, frame, sizeof frame);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_IGNORED);
    CHECK(fixture.sensors.write_calls == 0);
    CHECK(fixture.client.sent_count == 1u);
}

static void test_unknown_type_without_id_ignored(void) {
    uint8_t frame[FRAME_SIZE_COMMAND];
    fixture_t fixture;

    fixture_init(&fixture);
    memcpy(frame, COMMAND_SET_RATE_VECTOR, sizeof frame);
    frame[4] = 0u;
    frame[5] = 0u;
    frame[6] = 0u;
    frame[7] = 0u;
    frame[8] = 9u;
    seal_frame(frame, FRAME_SIZE_COMMAND);
    expect_frame(&fixture, frame, sizeof frame);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_IGNORED);
    CHECK(fixture.client.sent_count == 1u);
}

static void test_poll_send_failure(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    fixture.client.fail_send_call = 1;
    expect_frame(&fixture, COMMAND_SET_RATE_VECTOR, sizeof COMMAND_SET_RATE_VECTOR);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_TRANSPORT_ERROR);
    CHECK(fixture.client.send_calls == 1);
    CHECK(fixture.client.receive_calls == 0);
    CHECK(fixture.client.sent_count == 0u);
    CHECK(fixture.sensors.set_rate_calls == 0);
}

static void test_ack_send_failure(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    fixture.client.fail_send_call = 2;
    expect_frame(&fixture, COMMAND_SET_RATE_VECTOR, sizeof COMMAND_SET_RATE_VECTOR);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_TRANSPORT_ERROR);
    CHECK(fixture.client.send_calls == 2);
    CHECK(fixture.client.sent_count == 1u);
    CHECK(fixture.sensors.set_rate_calls == 1);
}

static void test_receive_timeout(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    fixture.client.receive_error = TCP_CLIENT_ERROR_TIMEOUT;

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_TIMEOUT);
    CHECK(fixture.client.sent_count == 1u);
    CHECK(fixture.client.receive_calls == 1);
}

static void test_receive_disconnect(void) {
    fixture_t fixture;

    fixture_init(&fixture);
    fixture.client.receive_error = TCP_CLIENT_ERROR_DISCONNECTED;

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_TRANSPORT_ERROR);
    CHECK(fixture.client.sent_count == 1u);
}

static void test_apply_failures(void) {
    ack_frame_t ack = {0};
    fixture_t fixture;

    fixture_init(&fixture);
    fixture.sensors.write_error = SENSOR_ERROR_IO;
    expect_frame(&fixture, COMMAND_TOGGLE_VECTOR, sizeof COMMAND_TOGGLE_VECTOR);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_REJECTED);
    CHECK(fixture.client.sent_count == 2u);
    CHECK(frame_decode_ack(fixture.client.sent[1], fixture.client.sent_lengths[1], &ack) ==
          FRAME_OK);
    CHECK(ack.status == FRAME_ACK_REJECTED);

    fixture_init(&fixture);
    fixture.sensors.set_rate_error = SENSOR_ERROR_IO;
    expect_frame(&fixture, COMMAND_SET_RATE_VECTOR, sizeof COMMAND_SET_RATE_VECTOR);

    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_REJECTED);
    CHECK(fixture.client.sent_count == 2u);
    CHECK(frame_decode_ack(fixture.client.sent[1], fixture.client.sent_lengths[1], &ack) ==
          FRAME_OK);
    CHECK(ack.command_id == TEST_COMMAND_ID);
    CHECK(ack.status == FRAME_ACK_REJECTED);
}

static void test_invalid_context(void) {
    fixture_t fixture;

    fixture_init(&fixture);

    CHECK(command_poll(NULL, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_ARGUMENT);

    fixture.context.device_id = 0u;
    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_ARGUMENT);

    fixture_init(&fixture);
    fixture.context.sensors = NULL;
    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_ARGUMENT);

    fixture_init(&fixture);
    fixture.context.client = NULL;
    CHECK(command_poll(&fixture.context, TEST_POLL_TIMEOUT_MS) == COMMAND_RESULT_ARGUMENT);

    CHECK(fixture.client.send_calls == 0);
}

static void test_result_names(void) {
    CHECK(strcmp(command_result_name(COMMAND_RESULT_NONE), "none") == 0);
    CHECK(strcmp(command_result_name(COMMAND_RESULT_EXECUTED), "executed") == 0);
    CHECK(strcmp(command_result_name(COMMAND_RESULT_TRANSPORT_ERROR), "transport-error") == 0);
    CHECK(strcmp(command_result_name(COMMAND_RESULT_ARGUMENT), "argument") == 0);
}

static void test_configuration(void) {
    CHECK(CONFIG_DEVICE_ID >= 1u && CONFIG_DEVICE_ID <= 65535u);
    CHECK(CONFIG_SAMPLE_RATE_SECONDS >= 1u && CONFIG_SAMPLE_RATE_SECONDS <= 255u);
    CHECK(CONFIG_SERVER_PORT >= 1u && CONFIG_SERVER_PORT <= 65535u);
    CHECK(CONFIG_POLL_TIMEOUT_MS > 0u);
    CHECK(CONFIG_RECONNECT_INITIAL_DELAY_MS > 0u);
    CHECK(CONFIG_RECONNECT_MAX_DELAY_MS >= CONFIG_RECONNECT_INITIAL_DELAY_MS);
    CHECK(strlen(CONFIG_SERVER_ADDRESS) > 0u);
}

int main(void) {
    test_set_sample_rate();
    test_toggle_gpio();
    test_no_command();
    test_rejected_parameters();
    test_rejected_state();
    test_unknown_type();
    test_other_device_ignored();
    test_bad_crc_ignored();
    test_bad_magic_ignored();
    test_wrong_length_ignored();
    test_empty_command_id_ignored();
    test_unknown_type_without_id_ignored();
    test_poll_send_failure();
    test_ack_send_failure();
    test_receive_timeout();
    test_receive_disconnect();
    test_apply_failures();
    test_invalid_context();
    test_result_names();
    test_configuration();

    return test_report("command layer");
}
