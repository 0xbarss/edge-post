/*
 * Board clock implementation — example reference.
 *
 * Adapts the STM32 HAL RTC / system tick into the edge-post device_clock_t
 * contract. The RTC source and frequencies come from board_config.h, which is
 * generated from your CubeMX .ioc file.
 *
 * To use: copy this file into your board's firmware tree, adapt the HAL calls
 * to your part (STM32G0 vs other families), and call board_clock_get() from main.c.
 */

#include "board_clock.h"

#include "board_config.h"

#include <stdint.h>

/* Opaque context: nothing extra needed beyond the function pointers below. */

static uint32_t board_clock_now_seconds(void *context)
{
    (void)context;

    /*
     * HAL adaptation: read the RTC counter and convert to Unix epoch seconds.
     * Example for STM32G0 with LSE-backed RTC:
     *
     *   RTC_DateTypeDef date;
     *   RTC_TimeTypeDef time;
     *   HAL_RTC_GetTime(&hrtc, &time, RTC_FORMAT_BIN);
     *   HAL_RTC_GetDate(&hrtc, &date, RTC_FORMAT_BIN);
     *   return unix_epoch_from_date_time(&date, &time);
     *
     * Return 0 when the clock has not been set (app treats timestamp 0 as an error).
     */

    return 0u;
}

static void board_clock_sleep_ms(void *context, uint32_t delay_ms)
{
    (void)context;

    /*
     * HAL adaptation: HAL_Delay(delay_ms) or a SysTick-based sleep.
     * Must block for at least delay_ms.
     */
}

static const device_clock_t board_clock = {
    .context = NULL,
    .now_seconds = board_clock_now_seconds,
    .sleep_ms = board_clock_sleep_ms,
};

const device_clock_t *board_clock_get(void)
{
    return &board_clock;
}
