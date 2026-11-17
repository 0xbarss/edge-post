#include "command.h"

#include "frame.h"

#include <stddef.h>

static int context_is_valid(const command_context_t *context) {
    return context != NULL && context->device_id != 0 && context->sensors != NULL &&
           context->client != NULL && context->client->send != NULL &&
           context->client->receive != NULL && context->sensors->write_gpio_pin != NULL &&
           context->sensors->set_sample_rate != NULL;
}

static command_result_t send_ack(const command_context_t *context, uint32_t command_id,
                                 uint8_t status, command_result_t result) {
    ack_frame_t frame = {
        .device_id = context->device_id,
        .command_id = command_id,
        .status = status,
    };
    uint8_t buffer[FRAME_SIZE_ACK] = {0};

    if (frame_encode_ack(&frame, buffer, sizeof buffer) != FRAME_OK) {
        return COMMAND_RESULT_ARGUMENT;
    }

    if (context->client->send(context->client->context, buffer, FRAME_SIZE_ACK) != TCP_CLIENT_OK) {
        return COMMAND_RESULT_TRANSPORT_ERROR;
    }

    return result;
}

static command_result_t apply_command(const command_context_t *context,
                                      const command_frame_t *command) {
    sensor_error_t error;

    switch (command->type) {
    case FRAME_COMMAND_TOGGLE_GPIO:
        error = context->sensors->write_gpio_pin(context->sensors->context, command->param1,
                                                 command->param2);
        break;
    case FRAME_COMMAND_SET_SAMPLE_RATE:
        error = context->sensors->set_sample_rate(context->sensors->context, command->param1);
        break;
    default:
        return send_ack(context, command->command_id, FRAME_ACK_UNSUPPORTED,
                        COMMAND_RESULT_UNSUPPORTED);
    }

    if (error != SENSOR_OK) {
        return send_ack(context, command->command_id, FRAME_ACK_REJECTED, COMMAND_RESULT_REJECTED);
    }

    return send_ack(context, command->command_id, FRAME_ACK_EXECUTED, COMMAND_RESULT_EXECUTED);
}

command_result_t command_poll(const command_context_t *context, uint32_t timeout_ms) {
    command_frame_t command = {0};
    uint8_t buffer[FRAME_MAX_SIZE] = {0};
    size_t length = 0;

    if (!context_is_valid(context)) {
        return COMMAND_RESULT_ARGUMENT;
    }

    poll_frame_t poll = {.device_id = context->device_id};

    if (frame_encode_poll(&poll, buffer, sizeof buffer) != FRAME_OK) {
        return COMMAND_RESULT_ARGUMENT;
    }

    if (context->client->send(context->client->context, buffer, FRAME_SIZE_POLL) != TCP_CLIENT_OK) {
        return COMMAND_RESULT_TRANSPORT_ERROR;
    }

    tcp_client_error_t receive_error = context->client->receive(context->client->context, buffer,
                                                                sizeof buffer, &length, timeout_ms);

    if (receive_error == TCP_CLIENT_ERROR_TIMEOUT) {
        return COMMAND_RESULT_TIMEOUT;
    }

    if (receive_error != TCP_CLIENT_OK) {
        return COMMAND_RESULT_TRANSPORT_ERROR;
    }

    frame_error_t decode_error = frame_decode_command(buffer, length, &command);

    if (command.device_id != context->device_id) {
        return COMMAND_RESULT_IGNORED;
    }

    switch (decode_error) {
    case FRAME_OK:
        break;
    case FRAME_ERROR_COMMAND_TYPE:
        if (command.command_id == 0) {
            return COMMAND_RESULT_IGNORED;
        }
        return send_ack(context, command.command_id, FRAME_ACK_UNSUPPORTED,
                        COMMAND_RESULT_UNSUPPORTED);
    case FRAME_ERROR_COMMAND_PARAMETER:
        if (command.command_id == 0) {
            return COMMAND_RESULT_IGNORED;
        }
        return send_ack(context, command.command_id, FRAME_ACK_REJECTED, COMMAND_RESULT_REJECTED);
    default:
        return COMMAND_RESULT_IGNORED;
    }

    if (command.type == FRAME_COMMAND_NONE) {
        return COMMAND_RESULT_NONE;
    }

    return apply_command(context, &command);
}

const char *command_result_name(command_result_t result) {
    switch (result) {
    case COMMAND_RESULT_NONE:
        return "none";
    case COMMAND_RESULT_EXECUTED:
        return "executed";
    case COMMAND_RESULT_REJECTED:
        return "rejected";
    case COMMAND_RESULT_UNSUPPORTED:
        return "unsupported";
    case COMMAND_RESULT_IGNORED:
        return "ignored";
    case COMMAND_RESULT_TIMEOUT:
        return "timeout";
    case COMMAND_RESULT_TRANSPORT_ERROR:
        return "transport-error";
    case COMMAND_RESULT_ARGUMENT:
        return "argument";
    }

    return "unknown";
}
