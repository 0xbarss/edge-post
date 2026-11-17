#ifndef EDGE_POST_FRAME_H
#define EDGE_POST_FRAME_H

#include <stddef.h>
#include <stdint.h>

#define FRAME_MAGIC_READING 0xEE50u
#define FRAME_MAGIC_ACK 0xEE51u
#define FRAME_MAGIC_POLL 0xEE52u
#define FRAME_MAGIC_COMMAND 0xEE53u

#define FRAME_SIZE_READING 15u
#define FRAME_SIZE_ACK 10u
#define FRAME_SIZE_POLL 5u
#define FRAME_SIZE_COMMAND 12u
#define FRAME_MAX_SIZE FRAME_SIZE_READING

#define FRAME_MIN_TEMPERATURE_TENTHS (-1000)
#define FRAME_MAX_TEMPERATURE_TENTHS 1500
#define FRAME_MAX_TIMESTAMP_SKEW_SECONDS 86400u

#define FRAME_COMMAND_NONE 0u
#define FRAME_COMMAND_TOGGLE_GPIO 1u
#define FRAME_COMMAND_SET_SAMPLE_RATE 2u

#define FRAME_ACK_EXECUTED 0u
#define FRAME_ACK_REJECTED 1u
#define FRAME_ACK_UNSUPPORTED 2u

typedef enum {
    FRAME_OK = 0,
    FRAME_ERROR_ARGUMENT,
    FRAME_ERROR_LENGTH,
    FRAME_ERROR_MAGIC,
    FRAME_ERROR_CRC,
    FRAME_ERROR_DEVICE_ID,
    FRAME_ERROR_SEQUENCE,
    FRAME_ERROR_SAMPLE_RATE,
    FRAME_ERROR_TIMESTAMP,
    FRAME_ERROR_TEMPERATURE,
    FRAME_ERROR_GPIO_STATE,
    FRAME_ERROR_COMMAND_ID,
    FRAME_ERROR_COMMAND_TYPE,
    FRAME_ERROR_COMMAND_PARAMETER,
    FRAME_ERROR_ACK_STATUS,
} frame_error_t;

typedef struct {
    uint16_t device_id;
    uint16_t sequence;
    uint32_t timestamp;
    int16_t temperature_tenths;
    uint8_t gpio_state;
    uint8_t sample_rate;
} reading_frame_t;

typedef struct {
    uint16_t device_id;
} poll_frame_t;

typedef struct {
    uint16_t device_id;
    uint32_t command_id;
    uint8_t type;
    uint8_t param1;
    uint8_t param2;
} command_frame_t;

typedef struct {
    uint16_t device_id;
    uint32_t command_id;
    uint8_t status;
} ack_frame_t;

/* Returns a stable name for a frame error code, suitable for logging. */
const char *frame_error_name(frame_error_t error);

/* CRC-8/ATM: polynomial 0x07, initial value 0x00, no reflection, final XOR 0x00. */
uint8_t crc8(const uint8_t *bytes, size_t length);

/* Encoders return FRAME_ERROR_ARGUMENT for a null pointer or an undersized buffer. */
frame_error_t frame_encode_reading(const reading_frame_t *frame, uint8_t *buffer, size_t capacity);
frame_error_t frame_encode_poll(const poll_frame_t *frame, uint8_t *buffer, size_t capacity);
frame_error_t frame_encode_command(const command_frame_t *frame, uint8_t *buffer, size_t capacity);
frame_error_t frame_encode_ack(const ack_frame_t *frame, uint8_t *buffer, size_t capacity);

/*
 * Decoders require the buffer to hold exactly one frame. Magic and CRC are checked before the
 * fields; on a field error the output struct is still populated so the caller can log or
 * acknowledge the frame.
 */
frame_error_t frame_decode_reading(const uint8_t *buffer, size_t length, reading_frame_t *frame);
frame_error_t frame_decode_poll(const uint8_t *buffer, size_t length, poll_frame_t *frame);
frame_error_t frame_decode_command(const uint8_t *buffer, size_t length, command_frame_t *frame);
frame_error_t frame_decode_ack(const uint8_t *buffer, size_t length, ack_frame_t *frame);

/* Applies the timestamp window on top of the field checks performed during decoding. */
frame_error_t frame_validate_reading(const reading_frame_t *frame, uint32_t now_seconds);

#endif
