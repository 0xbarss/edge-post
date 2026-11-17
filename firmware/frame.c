#include "frame.h"

static void write_u16_be(uint8_t *buffer, size_t offset, uint16_t value) {
    buffer[offset] = (uint8_t)(value >> 8);
    buffer[offset + 1] = (uint8_t)(value & 0xFFu);
}

static uint16_t read_u16_be(const uint8_t *buffer, size_t offset) {
    return (uint16_t)(((uint16_t)buffer[offset] << 8) | (uint16_t)buffer[offset + 1]);
}

static void write_u32_be(uint8_t *buffer, size_t offset, uint32_t value) {
    buffer[offset] = (uint8_t)(value >> 24);
    buffer[offset + 1] = (uint8_t)(value >> 16);
    buffer[offset + 2] = (uint8_t)(value >> 8);
    buffer[offset + 3] = (uint8_t)(value & 0xFFu);
}

static uint32_t read_u32_be(const uint8_t *buffer, size_t offset) {
    return ((uint32_t)buffer[offset] << 24) | ((uint32_t)buffer[offset + 1] << 16) |
           ((uint32_t)buffer[offset + 2] << 8) | (uint32_t)buffer[offset + 3];
}

const char *frame_error_name(frame_error_t error) {
    switch (error) {
    case FRAME_OK:
        return "ok";
    case FRAME_ERROR_ARGUMENT:
        return "argument";
    case FRAME_ERROR_LENGTH:
        return "length";
    case FRAME_ERROR_MAGIC:
        return "magic";
    case FRAME_ERROR_CRC:
        return "crc";
    case FRAME_ERROR_DEVICE_ID:
        return "device-id";
    case FRAME_ERROR_SEQUENCE:
        return "sequence";
    case FRAME_ERROR_SAMPLE_RATE:
        return "sample-rate";
    case FRAME_ERROR_TIMESTAMP:
        return "timestamp";
    case FRAME_ERROR_TEMPERATURE:
        return "temperature";
    case FRAME_ERROR_GPIO_STATE:
        return "gpio-state";
    case FRAME_ERROR_COMMAND_ID:
        return "command-id";
    case FRAME_ERROR_COMMAND_TYPE:
        return "command-type";
    case FRAME_ERROR_COMMAND_PARAMETER:
        return "command-parameter";
    case FRAME_ERROR_ACK_STATUS:
        return "ack-status";
    }

    return "unknown";
}

uint8_t crc8(const uint8_t *bytes, size_t length) {
    uint8_t crc = 0x00u;

    if (bytes == NULL) {
        return crc;
    }

    for (size_t index = 0; index < length; index += 1) {
        crc ^= bytes[index];
        for (uint8_t bit = 0; bit < 8u; bit += 1) {
            crc = (crc & 0x80u) != 0u ? (uint8_t)((crc << 1) ^ 0x07u) : (uint8_t)(crc << 1);
        }
    }

    return crc;
}

static frame_error_t validate_reading_fields(const reading_frame_t *frame) {
    if (frame->device_id == 0) {
        return FRAME_ERROR_DEVICE_ID;
    }

    if (frame->timestamp == 0) {
        return FRAME_ERROR_TIMESTAMP;
    }

    if (frame->sample_rate == 0) {
        return FRAME_ERROR_SAMPLE_RATE;
    }

    if (frame->temperature_tenths < FRAME_MIN_TEMPERATURE_TENTHS ||
        frame->temperature_tenths > FRAME_MAX_TEMPERATURE_TENTHS) {
        return FRAME_ERROR_TEMPERATURE;
    }

    return FRAME_OK;
}

static frame_error_t validate_command_fields(const command_frame_t *frame) {
    if (frame->device_id == 0) {
        return FRAME_ERROR_DEVICE_ID;
    }

    switch (frame->type) {
    case FRAME_COMMAND_NONE:
        if (frame->command_id != 0) {
            return FRAME_ERROR_COMMAND_ID;
        }
        if (frame->param1 != 0 || frame->param2 != 0) {
            return FRAME_ERROR_COMMAND_PARAMETER;
        }
        return FRAME_OK;
    case FRAME_COMMAND_TOGGLE_GPIO:
        if (frame->command_id == 0) {
            return FRAME_ERROR_COMMAND_ID;
        }
        if (frame->param1 > 7u) {
            return FRAME_ERROR_COMMAND_PARAMETER;
        }
        if (frame->param2 > 1u) {
            return FRAME_ERROR_COMMAND_PARAMETER;
        }
        return FRAME_OK;
    case FRAME_COMMAND_SET_SAMPLE_RATE:
        if (frame->command_id == 0) {
            return FRAME_ERROR_COMMAND_ID;
        }
        if (frame->param1 == 0) {
            return FRAME_ERROR_COMMAND_PARAMETER;
        }
        if (frame->param2 != 0) {
            return FRAME_ERROR_COMMAND_PARAMETER;
        }
        return FRAME_OK;
    default:
        return FRAME_ERROR_COMMAND_TYPE;
    }
}

static frame_error_t validate_ack_fields(const ack_frame_t *frame) {
    if (frame->device_id == 0) {
        return FRAME_ERROR_DEVICE_ID;
    }

    if (frame->status > FRAME_ACK_UNSUPPORTED) {
        return FRAME_ERROR_ACK_STATUS;
    }

    return FRAME_OK;
}

frame_error_t frame_encode_reading(const reading_frame_t *frame, uint8_t *buffer, size_t capacity) {
    if (frame == NULL || buffer == NULL || capacity < FRAME_SIZE_READING) {
        return FRAME_ERROR_ARGUMENT;
    }

    frame_error_t error = validate_reading_fields(frame);
    if (error != FRAME_OK) {
        return error;
    }

    write_u16_be(buffer, 0, FRAME_MAGIC_READING);
    write_u16_be(buffer, 2, frame->device_id);
    write_u16_be(buffer, 4, frame->sequence);
    write_u32_be(buffer, 6, frame->timestamp);
    write_u16_be(buffer, 10, (uint16_t)frame->temperature_tenths);
    buffer[12] = frame->gpio_state;
    buffer[13] = frame->sample_rate;
    buffer[14] = crc8(buffer, FRAME_SIZE_READING - 1);

    return FRAME_OK;
}

frame_error_t frame_encode_poll(const poll_frame_t *frame, uint8_t *buffer, size_t capacity) {
    if (frame == NULL || buffer == NULL || capacity < FRAME_SIZE_POLL) {
        return FRAME_ERROR_ARGUMENT;
    }

    if (frame->device_id == 0) {
        return FRAME_ERROR_DEVICE_ID;
    }

    write_u16_be(buffer, 0, FRAME_MAGIC_POLL);
    write_u16_be(buffer, 2, frame->device_id);
    buffer[4] = crc8(buffer, FRAME_SIZE_POLL - 1);

    return FRAME_OK;
}

frame_error_t frame_encode_command(const command_frame_t *frame, uint8_t *buffer, size_t capacity) {
    if (frame == NULL || buffer == NULL || capacity < FRAME_SIZE_COMMAND) {
        return FRAME_ERROR_ARGUMENT;
    }

    frame_error_t error = validate_command_fields(frame);
    if (error != FRAME_OK) {
        return error;
    }

    write_u16_be(buffer, 0, FRAME_MAGIC_COMMAND);
    write_u16_be(buffer, 2, frame->device_id);
    write_u32_be(buffer, 4, frame->command_id);
    buffer[8] = frame->type;
    buffer[9] = frame->param1;
    buffer[10] = frame->param2;
    buffer[11] = crc8(buffer, FRAME_SIZE_COMMAND - 1);

    return FRAME_OK;
}

frame_error_t frame_encode_ack(const ack_frame_t *frame, uint8_t *buffer, size_t capacity) {
    if (frame == NULL || buffer == NULL || capacity < FRAME_SIZE_ACK) {
        return FRAME_ERROR_ARGUMENT;
    }

    frame_error_t error = validate_ack_fields(frame);
    if (error != FRAME_OK) {
        return error;
    }

    write_u16_be(buffer, 0, FRAME_MAGIC_ACK);
    write_u16_be(buffer, 2, frame->device_id);
    write_u32_be(buffer, 4, frame->command_id);
    buffer[8] = frame->status;
    buffer[9] = crc8(buffer, FRAME_SIZE_ACK - 1);

    return FRAME_OK;
}

frame_error_t frame_decode_reading(const uint8_t *buffer, size_t length, reading_frame_t *frame) {
    if (buffer == NULL || frame == NULL) {
        return FRAME_ERROR_ARGUMENT;
    }

    if (length != FRAME_SIZE_READING) {
        return FRAME_ERROR_LENGTH;
    }

    if (read_u16_be(buffer, 0) != FRAME_MAGIC_READING) {
        return FRAME_ERROR_MAGIC;
    }

    if (crc8(buffer, FRAME_SIZE_READING - 1) != buffer[FRAME_SIZE_READING - 1]) {
        return FRAME_ERROR_CRC;
    }

    frame->device_id = read_u16_be(buffer, 2);
    frame->sequence = read_u16_be(buffer, 4);
    frame->timestamp = read_u32_be(buffer, 6);
    frame->temperature_tenths = (int16_t)read_u16_be(buffer, 10);
    frame->gpio_state = buffer[12];
    frame->sample_rate = buffer[13];

    return validate_reading_fields(frame);
}

frame_error_t frame_decode_poll(const uint8_t *buffer, size_t length, poll_frame_t *frame) {
    if (buffer == NULL || frame == NULL) {
        return FRAME_ERROR_ARGUMENT;
    }

    if (length != FRAME_SIZE_POLL) {
        return FRAME_ERROR_LENGTH;
    }

    if (read_u16_be(buffer, 0) != FRAME_MAGIC_POLL) {
        return FRAME_ERROR_MAGIC;
    }

    if (crc8(buffer, FRAME_SIZE_POLL - 1) != buffer[FRAME_SIZE_POLL - 1]) {
        return FRAME_ERROR_CRC;
    }

    frame->device_id = read_u16_be(buffer, 2);

    if (frame->device_id == 0) {
        return FRAME_ERROR_DEVICE_ID;
    }

    return FRAME_OK;
}

frame_error_t frame_decode_command(const uint8_t *buffer, size_t length, command_frame_t *frame) {
    if (buffer == NULL || frame == NULL) {
        return FRAME_ERROR_ARGUMENT;
    }

    if (length != FRAME_SIZE_COMMAND) {
        return FRAME_ERROR_LENGTH;
    }

    if (read_u16_be(buffer, 0) != FRAME_MAGIC_COMMAND) {
        return FRAME_ERROR_MAGIC;
    }

    if (crc8(buffer, FRAME_SIZE_COMMAND - 1) != buffer[FRAME_SIZE_COMMAND - 1]) {
        return FRAME_ERROR_CRC;
    }

    frame->device_id = read_u16_be(buffer, 2);
    frame->command_id = read_u32_be(buffer, 4);
    frame->type = buffer[8];
    frame->param1 = buffer[9];
    frame->param2 = buffer[10];

    return validate_command_fields(frame);
}

frame_error_t frame_decode_ack(const uint8_t *buffer, size_t length, ack_frame_t *frame) {
    if (buffer == NULL || frame == NULL) {
        return FRAME_ERROR_ARGUMENT;
    }

    if (length != FRAME_SIZE_ACK) {
        return FRAME_ERROR_LENGTH;
    }

    if (read_u16_be(buffer, 0) != FRAME_MAGIC_ACK) {
        return FRAME_ERROR_MAGIC;
    }

    if (crc8(buffer, FRAME_SIZE_ACK - 1) != buffer[FRAME_SIZE_ACK - 1]) {
        return FRAME_ERROR_CRC;
    }

    frame->device_id = read_u16_be(buffer, 2);
    frame->command_id = read_u32_be(buffer, 4);
    frame->status = buffer[8];

    return validate_ack_fields(frame);
}

frame_error_t frame_validate_reading(const reading_frame_t *frame, uint32_t now_seconds) {
    if (frame == NULL) {
        return FRAME_ERROR_ARGUMENT;
    }

    frame_error_t error = validate_reading_fields(frame);
    if (error != FRAME_OK) {
        return error;
    }

    if ((uint64_t)frame->timestamp >
        (uint64_t)now_seconds + (uint64_t)FRAME_MAX_TIMESTAMP_SKEW_SECONDS) {
        return FRAME_ERROR_TIMESTAMP;
    }

    return FRAME_OK;
}
