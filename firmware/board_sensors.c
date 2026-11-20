/*
 * Board sensor implementation — example reference.
 *
 * Adapts STM32 HAL ADC (temperature) and GPIO outputs into the edge-post
 * sensors_t contract. All pin references come from board_config.h role macros:
 *
 *   BOARD_TEMP_ADC_INSTANCE / BOARD_TEMP_ADC_CHANNEL / BOARD_TEMP_ADC_PIN
 *   BOARD_OUT_COUNT         / BOARD_OUT<n>_PIN
 *
 * Copy/adapt for your board after adding TEMP_ and OUT_ labels in CubeMX.
 */

#include "board_sensors.h"

#include "board_config.h"

#include <stdint.h>

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

typedef struct {
    uint8_t sample_rate_seconds;
    uint8_t gpio_state;
} board_sensors_ctx_t;

static board_sensors_ctx_t g_sensors = {
    .sample_rate_seconds = 5u,
    .gpio_state = 0u,
};

/* -------------------------------------------------------------------------- */
/* Temperature read                                                           */
/* -------------------------------------------------------------------------- */

static sensor_error_t board_read_temperature_tenths(void *context, int16_t *tenths)
{
    (void)context;

    if (tenths == NULL) {
        return SENSOR_ERROR_ARGUMENT;
    }

#ifdef BOARD_TEMP_ADC_CHANNEL
    /*
     * HAL adaptation example. Replace with your part's ADC calls:
     *
     *   ADC_ChannelConfTypeDef sConfig = {0};
     *   sConfig.Channel = ADC_CHANNEL_0;          /* map from BOARD_TEMP_ADC_CHANNEL *
     *   sConfig.Rank = ADC_REGULAR_RANK_1;
     *   HAL_ADC_ConfigChannel(&hadc1, &sConfig);
     *   HAL_ADC_Start(&hadc1);
     *   HAL_ADC_PollForConversion(&hadc1, 100);
     *   uint32_t raw = HAL_ADC_GetValue(&hadc1);
     *   HAL_ADC_Stop(&hadc1);
     *
     *   *tenths = (int16_t)((raw * 3300) / 4095 / 10);  /* mV -> tenths of C *
     */

    /* Placeholder: return a nominal room temperature (24.5 °C = 245 tenths). */
    *tenths = 245;
    return SENSOR_OK;
#else
    /* No temperature role configured on this board. */
    return SENSOR_ERROR_PIN;
#endif
}

/* -------------------------------------------------------------------------- */
/* GPIO state read / write                                                    */
/* -------------------------------------------------------------------------- */

static sensor_error_t board_read_gpio_state(void *context, uint8_t *state)
{
    (void)context;

    if (state == NULL) {
        return SENSOR_ERROR_ARGUMENT;
    }

    *state = g_sensors.gpio_state;
    return SENSOR_OK;
}

static sensor_error_t board_write_gpio_pin(void *context, uint8_t pin, uint8_t state)
{
    (void)context;

    if (pin >= 8u || (state != 0u && state != 1u)) {
        return SENSOR_ERROR_ARGUMENT;
    }

#ifdef BOARD_OUT_COUNT
    /*
     * Validate that the requested pin is one of the configured outputs.
     * HAL adaptation: HAL_GPIO_WritePin(GPIOx, GPIO_PIN_x, state);
     * where GPIOx/pin are derived from BOARD_OUT<n>_PIN ("PB5" -> GPIOB, pin 5).
     */
    for (uint8_t i = 0u; i < BOARD_OUT_COUNT; i++) {
#ifdef BOARD_OUT0_PIN
        if (i == 0u && pin == 5u) { /* PB5 example — adapt to your pin parser */
            g_sensors.gpio_state = (state == 1u)
                ? (uint8_t)(g_sensors.gpio_state | (1u << pin))
                : (uint8_t)(g_sensors.gpio_state & ~(1u << pin));
            return SENSOR_OK;
        }
#endif
    }

    return SENSOR_ERROR_PIN;
#else
    /* No outputs configured on this board. */
    return SENSOR_ERROR_PIN;
#endif
}

/* -------------------------------------------------------------------------- */
/* Sample rate                                                                */
/* -------------------------------------------------------------------------- */

static sensor_error_t board_set_sample_rate(void *context, uint8_t seconds)
{
    (void)context;

    if (seconds < 1u || seconds > 255u) {
        return SENSOR_ERROR_RATE;
    }

    g_sensors.sample_rate_seconds = seconds;
    return SENSOR_OK;
}

static uint8_t board_get_sample_rate(void *context)
{
    (void)context;
    return g_sensors.sample_rate_seconds;
}

/* -------------------------------------------------------------------------- */
/* Interface table                                                            */
/* -------------------------------------------------------------------------- */

static const sensors_t board_sensors = {
    .context = &g_sensors,
    .read_temperature_tenths = board_read_temperature_tenths,
    .read_gpio_state = board_read_gpio_state,
    .write_gpio_pin = board_write_gpio_pin,
    .set_sample_rate = board_set_sample_rate,
    .get_sample_rate = board_get_sample_rate,
};

const sensors_t *board_sensors_get(void)
{
    return &board_sensors;
}
