#include "frame.h"

#include "frame_vectors.h"
#include "test_support.h"

#include <string.h>

static void test_crc(void) {
    static const uint8_t check_input[] = {'1', '2', '3', '4', '5', '6', '7', '8', '9'};

    CHECK(crc8(check_input, sizeof check_input) == 0xF4u);
    CHECK(crc8(NULL, sizeof check_input) == 0x00u);
}

static void test_reading(void) {
    reading_frame_t source = {
        .device_id = 0x1234u,
        .sequence = 7u,
        .timestamp = 1794744000u,
        .temperature_tenths = 234,
        .gpio_state = 0x05u,
        .sample_rate = 5u,
    };
    reading_frame_t decoded = {0};
    uint8_t encoded[FRAME_SIZE_READING] = {0};

    CHECK(frame_encode_reading(&source, encoded, sizeof encoded) == FRAME_OK);
    CHECK(memcmp(encoded, READING_VECTOR, sizeof encoded) == 0);

    CHECK(frame_decode_reading(READING_VECTOR, sizeof READING_VECTOR, &decoded) == FRAME_OK);
    CHECK(decoded.device_id == 0x1234u);
    CHECK(decoded.sequence == 7u);
    CHECK(decoded.timestamp == 1794744000u);
    CHECK(decoded.temperature_tenths == 234);
    CHECK(decoded.gpio_state == 0x05u);
    CHECK(decoded.sample_rate == 5u);

    CHECK(frame_encode_reading(&decoded, encoded, sizeof encoded) == FRAME_OK);
    CHECK(memcmp(encoded, READING_VECTOR, sizeof encoded) == 0);

    source.device_id = 65535u;
    source.sequence = 65535u;
    source.timestamp = 1u;
    source.temperature_tenths = -1000;
    source.gpio_state = 0xFFu;
    source.sample_rate = 255u;
    CHECK(frame_encode_reading(&source, encoded, sizeof encoded) == FRAME_OK);

    source.temperature_tenths = 1500;
    CHECK(frame_encode_reading(&source, encoded, sizeof encoded) == FRAME_OK);

    source.timestamp = 0xFFFFFFFFu;
    CHECK(frame_encode_reading(&source, encoded, sizeof encoded) == FRAME_OK);
}

static void test_reading_validation(void) {
    reading_frame_t frame = {
        .device_id = 0x1234u,
        .sequence = 1u,
        .timestamp = 1794744000u,
        .temperature_tenths = 234,
        .gpio_state = 0u,
        .sample_rate = 5u,
    };
    uint8_t buffer[FRAME_SIZE_READING] = {0};
    uint8_t corrupted[FRAME_SIZE_READING];

    frame.device_id = 0u;
    CHECK(frame_encode_reading(&frame, buffer, sizeof buffer) == FRAME_ERROR_DEVICE_ID);
    frame.device_id = 0x1234u;

    frame.timestamp = 0u;
    CHECK(frame_encode_reading(&frame, buffer, sizeof buffer) == FRAME_ERROR_TIMESTAMP);
    frame.timestamp = 1794744000u;

    frame.sample_rate = 0u;
    CHECK(frame_encode_reading(&frame, buffer, sizeof buffer) == FRAME_ERROR_SAMPLE_RATE);
    frame.sample_rate = 5u;

    frame.temperature_tenths = -1001;
    CHECK(frame_encode_reading(&frame, buffer, sizeof buffer) == FRAME_ERROR_TEMPERATURE);
    frame.temperature_tenths = 1501;
    CHECK(frame_encode_reading(&frame, buffer, sizeof buffer) == FRAME_ERROR_TEMPERATURE);
    frame.temperature_tenths = 234;

    CHECK(frame_encode_reading(&frame, NULL, sizeof buffer) == FRAME_ERROR_ARGUMENT);
    CHECK(frame_encode_reading(&frame, buffer, sizeof buffer - 1u) == FRAME_ERROR_ARGUMENT);
    CHECK(frame_encode_reading(NULL, buffer, sizeof buffer) == FRAME_ERROR_ARGUMENT);

    CHECK(frame_decode_reading(READING_VECTOR, sizeof READING_VECTOR - 1u, &frame) ==
          FRAME_ERROR_LENGTH);
    CHECK(frame_decode_reading(READING_VECTOR, sizeof READING_VECTOR + 1u, &frame) ==
          FRAME_ERROR_LENGTH);
    CHECK(frame_decode_reading(NULL, sizeof READING_VECTOR, &frame) == FRAME_ERROR_ARGUMENT);
    CHECK(frame_decode_reading(READING_VECTOR, sizeof READING_VECTOR, NULL) ==
          FRAME_ERROR_ARGUMENT);

    memcpy(corrupted, READING_VECTOR, sizeof corrupted);
    corrupted[1] = 0x99u;
    CHECK(frame_decode_reading(corrupted, sizeof corrupted, &frame) == FRAME_ERROR_MAGIC);

    memcpy(corrupted, READING_VECTOR, sizeof corrupted);
    corrupted[14] ^= 0xFFu;
    CHECK(frame_decode_reading(corrupted, sizeof corrupted, &frame) == FRAME_ERROR_CRC);

    memcpy(corrupted, READING_VECTOR, sizeof corrupted);
    corrupted[6] ^= 0x01u;
    CHECK(frame_decode_reading(corrupted, sizeof corrupted, &frame) == FRAME_ERROR_CRC);

    frame.timestamp = 1794744000u;
    CHECK(frame_validate_reading(&frame, 1794744000u) == FRAME_OK);
    frame.timestamp = 1794744000u + FRAME_MAX_TIMESTAMP_SKEW_SECONDS;
    CHECK(frame_validate_reading(&frame, 1794744000u) == FRAME_OK);
    frame.timestamp = 1794744000u + FRAME_MAX_TIMESTAMP_SKEW_SECONDS + 1u;
    CHECK(frame_validate_reading(&frame, 1794744000u) == FRAME_ERROR_TIMESTAMP);
    frame.timestamp = 1794744000u;
    CHECK(frame_validate_reading(NULL, 1794744000u) == FRAME_ERROR_ARGUMENT);
}

static void test_poll(void) {
    poll_frame_t source = {.device_id = 0x1234u};
    poll_frame_t decoded = {0};
    uint8_t encoded[FRAME_SIZE_POLL] = {0};
    uint8_t corrupted[FRAME_SIZE_POLL];

    CHECK(frame_encode_poll(&source, encoded, sizeof encoded) == FRAME_OK);
    CHECK(memcmp(encoded, POLL_VECTOR, sizeof encoded) == 0);

    CHECK(frame_decode_poll(POLL_VECTOR, sizeof POLL_VECTOR, &decoded) == FRAME_OK);
    CHECK(decoded.device_id == 0x1234u);

    source.device_id = 0u;
    CHECK(frame_encode_poll(&source, encoded, sizeof encoded) == FRAME_ERROR_DEVICE_ID);
    CHECK(frame_encode_poll(NULL, encoded, sizeof encoded) == FRAME_ERROR_ARGUMENT);
    CHECK(frame_encode_poll(&source, encoded, sizeof encoded - 1u) == FRAME_ERROR_ARGUMENT);

    CHECK(frame_decode_poll(POLL_VECTOR, sizeof POLL_VECTOR - 1u, &decoded) == FRAME_ERROR_LENGTH);

    memcpy(corrupted, POLL_VECTOR, sizeof corrupted);
    corrupted[1] = 0x53u;
    CHECK(frame_decode_poll(corrupted, sizeof corrupted, &decoded) == FRAME_ERROR_MAGIC);

    memcpy(corrupted, POLL_VECTOR, sizeof corrupted);
    corrupted[4] ^= 0xFFu;
    CHECK(frame_decode_poll(corrupted, sizeof corrupted, &decoded) == FRAME_ERROR_CRC);

    memcpy(corrupted, POLL_VECTOR, sizeof corrupted);
    corrupted[2] = 0u;
    corrupted[3] = 0u;
    seal_frame(corrupted, sizeof corrupted);
    CHECK(frame_decode_poll(corrupted, sizeof corrupted, &decoded) == FRAME_ERROR_DEVICE_ID);
}

static void test_command(void) {
    command_frame_t source = {
        .device_id = 0x1234u,
        .command_id = 0u,
        .type = FRAME_COMMAND_NONE,
        .param1 = 0u,
        .param2 = 0u,
    };
    command_frame_t decoded = {0};
    uint8_t encoded[FRAME_SIZE_COMMAND] = {0};
    uint8_t corrupted[FRAME_SIZE_COMMAND];

    CHECK(frame_encode_command(&source, encoded, sizeof encoded) == FRAME_OK);
    CHECK(memcmp(encoded, COMMAND_NONE_VECTOR, sizeof encoded) == 0);
    CHECK(frame_decode_command(COMMAND_NONE_VECTOR, sizeof COMMAND_NONE_VECTOR, &decoded) ==
          FRAME_OK);
    CHECK(decoded.device_id == 0x1234u);
    CHECK(decoded.command_id == 0u);
    CHECK(decoded.type == FRAME_COMMAND_NONE);
    CHECK(decoded.param1 == 0u);
    CHECK(decoded.param2 == 0u);

    source.command_id = 42u;
    source.type = FRAME_COMMAND_SET_SAMPLE_RATE;
    source.param1 = 10u;
    CHECK(frame_encode_command(&source, encoded, sizeof encoded) == FRAME_OK);
    CHECK(memcmp(encoded, COMMAND_SET_RATE_VECTOR, sizeof encoded) == 0);
    CHECK(frame_decode_command(COMMAND_SET_RATE_VECTOR, sizeof COMMAND_SET_RATE_VECTOR, &decoded) ==
          FRAME_OK);
    CHECK(decoded.command_id == 42u);
    CHECK(decoded.type == FRAME_COMMAND_SET_SAMPLE_RATE);
    CHECK(decoded.param1 == 10u);
    CHECK(decoded.param2 == 0u);

    source.command_id = 43u;
    source.type = FRAME_COMMAND_TOGGLE_GPIO;
    source.param1 = 3u;
    source.param2 = 1u;
    CHECK(frame_encode_command(&source, encoded, sizeof encoded) == FRAME_OK);
    CHECK(memcmp(encoded, COMMAND_TOGGLE_VECTOR, sizeof encoded) == 0);
    CHECK(frame_decode_command(COMMAND_TOGGLE_VECTOR, sizeof COMMAND_TOGGLE_VECTOR, &decoded) ==
          FRAME_OK);
    CHECK(decoded.command_id == 43u);
    CHECK(decoded.type == FRAME_COMMAND_TOGGLE_GPIO);
    CHECK(decoded.param1 == 3u);
    CHECK(decoded.param2 == 1u);

    source.device_id = 0u;
    CHECK(frame_encode_command(&source, encoded, sizeof encoded) == FRAME_ERROR_DEVICE_ID);
    source.device_id = 0x1234u;

    source.command_id = 0u;
    CHECK(frame_encode_command(&source, encoded, sizeof encoded) == FRAME_ERROR_COMMAND_ID);
    source.command_id = 43u;

    source.command_id = 0u;
    source.type = FRAME_COMMAND_NONE;
    CHECK(frame_encode_command(&source, encoded, sizeof encoded) == FRAME_ERROR_COMMAND_PARAMETER);
    source.command_id = 43u;
    source.type = FRAME_COMMAND_TOGGLE_GPIO;

    source.param1 = 8u;
    CHECK(frame_encode_command(&source, encoded, sizeof encoded) == FRAME_ERROR_COMMAND_PARAMETER);
    source.param1 = 3u;

    source.param2 = 2u;
    CHECK(frame_encode_command(&source, encoded, sizeof encoded) == FRAME_ERROR_COMMAND_PARAMETER);
    source.param2 = 1u;

    source.type = FRAME_COMMAND_SET_SAMPLE_RATE;
    source.param1 = 0u;
    CHECK(frame_encode_command(&source, encoded, sizeof encoded) == FRAME_ERROR_COMMAND_PARAMETER);
    source.param1 = 10u;

    source.param2 = 1u;
    CHECK(frame_encode_command(&source, encoded, sizeof encoded) == FRAME_ERROR_COMMAND_PARAMETER);
    source.param2 = 0u;

    source.type = 3u;
    CHECK(frame_encode_command(&source, encoded, sizeof encoded) == FRAME_ERROR_COMMAND_TYPE);
    source.type = FRAME_COMMAND_SET_SAMPLE_RATE;

    CHECK(frame_encode_command(NULL, encoded, sizeof encoded) == FRAME_ERROR_ARGUMENT);
    CHECK(frame_encode_command(&source, encoded, sizeof encoded - 1u) == FRAME_ERROR_ARGUMENT);

    CHECK(frame_decode_command(COMMAND_NONE_VECTOR, sizeof COMMAND_NONE_VECTOR - 1u, &decoded) ==
          FRAME_ERROR_LENGTH);

    memcpy(corrupted, COMMAND_NONE_VECTOR, sizeof corrupted);
    corrupted[1] = 0x52u;
    CHECK(frame_decode_command(corrupted, sizeof corrupted, &decoded) == FRAME_ERROR_MAGIC);

    memcpy(corrupted, COMMAND_NONE_VECTOR, sizeof corrupted);
    corrupted[11] ^= 0xFFu;
    CHECK(frame_decode_command(corrupted, sizeof corrupted, &decoded) == FRAME_ERROR_CRC);

    memcpy(corrupted, COMMAND_NONE_VECTOR, sizeof corrupted);
    corrupted[2] = 0u;
    corrupted[3] = 0u;
    seal_frame(corrupted, sizeof corrupted);
    CHECK(frame_decode_command(corrupted, sizeof corrupted, &decoded) == FRAME_ERROR_DEVICE_ID);

    memcpy(corrupted, COMMAND_TOGGLE_VECTOR, sizeof corrupted);
    corrupted[8] = 3u;
    seal_frame(corrupted, sizeof corrupted);
    CHECK(frame_decode_command(corrupted, sizeof corrupted, &decoded) == FRAME_ERROR_COMMAND_TYPE);
    CHECK(decoded.command_id == 43u);
    CHECK(decoded.type == 3u);
}

static void test_ack(void) {
    ack_frame_t source = {
        .device_id = 0x1234u,
        .command_id = 42u,
        .status = FRAME_ACK_EXECUTED,
    };
    ack_frame_t decoded = {0};
    uint8_t encoded[FRAME_SIZE_ACK] = {0};
    uint8_t corrupted[FRAME_SIZE_ACK];

    CHECK(frame_encode_ack(&source, encoded, sizeof encoded) == FRAME_OK);
    CHECK(memcmp(encoded, ACK_EXECUTED_VECTOR, sizeof encoded) == 0);

    CHECK(frame_decode_ack(ACK_EXECUTED_VECTOR, sizeof ACK_EXECUTED_VECTOR, &decoded) == FRAME_OK);
    CHECK(decoded.device_id == 0x1234u);
    CHECK(decoded.command_id == 42u);
    CHECK(decoded.status == FRAME_ACK_EXECUTED);

    source.command_id = 43u;
    source.status = FRAME_ACK_REJECTED;
    CHECK(frame_encode_ack(&source, encoded, sizeof encoded) == FRAME_OK);
    CHECK(memcmp(encoded, ACK_REJECTED_VECTOR, sizeof encoded) == 0);
    CHECK(frame_decode_ack(ACK_REJECTED_VECTOR, sizeof ACK_REJECTED_VECTOR, &decoded) == FRAME_OK);
    CHECK(decoded.command_id == 43u);
    CHECK(decoded.status == FRAME_ACK_REJECTED);

    source.device_id = 0u;
    CHECK(frame_encode_ack(&source, encoded, sizeof encoded) == FRAME_ERROR_DEVICE_ID);
    source.device_id = 0x1234u;

    source.status = 3u;
    CHECK(frame_encode_ack(&source, encoded, sizeof encoded) == FRAME_ERROR_ACK_STATUS);
    CHECK(frame_encode_ack(NULL, encoded, sizeof encoded) == FRAME_ERROR_ARGUMENT);
    CHECK(frame_encode_ack(&source, encoded, sizeof encoded - 1u) == FRAME_ERROR_ARGUMENT);

    CHECK(frame_decode_ack(ACK_EXECUTED_VECTOR, sizeof ACK_EXECUTED_VECTOR - 1u, &decoded) ==
          FRAME_ERROR_LENGTH);

    memcpy(corrupted, ACK_EXECUTED_VECTOR, sizeof corrupted);
    corrupted[1] = 0x52u;
    CHECK(frame_decode_ack(corrupted, sizeof corrupted, &decoded) == FRAME_ERROR_MAGIC);

    memcpy(corrupted, ACK_EXECUTED_VECTOR, sizeof corrupted);
    corrupted[9] ^= 0xFFu;
    CHECK(frame_decode_ack(corrupted, sizeof corrupted, &decoded) == FRAME_ERROR_CRC);

    memcpy(corrupted, ACK_EXECUTED_VECTOR, sizeof corrupted);
    corrupted[8] = 3u;
    seal_frame(corrupted, sizeof corrupted);
    CHECK(frame_decode_ack(corrupted, sizeof corrupted, &decoded) == FRAME_ERROR_ACK_STATUS);
}

static void test_error_names(void) {
    CHECK(strcmp(frame_error_name(FRAME_OK), "ok") == 0);
    CHECK(strcmp(frame_error_name(FRAME_ERROR_CRC), "crc") == 0);
    CHECK(strcmp(frame_error_name(FRAME_ERROR_ACK_STATUS), "ack-status") == 0);
}

int main(void) {
    test_crc();
    test_reading();
    test_reading_validation();
    test_poll();
    test_command();
    test_ack();
    test_error_names();

    return test_report("frame codec");
}
