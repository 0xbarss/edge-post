/*
 * Board TCP client implementation — example reference.
 *
 * Adapts the WIZnet W7500P (over SPI or UART per board_config.h) into the
 * edge-post tcp_client_t contract. Copy/adapt for your board after adding
 * NET_ and NET_CS labels in CubeMX.
 *
 * Network role macros used:
 *   BOARD_NET_SPI_INSTANCE / BOARD_NET_SPI_SCK_PIN / BOARD_NET_SPI_MISO_PIN /
 *   BOARD_NET_SPI_MOSI_PIN / BOARD_NET_CS_PIN   (SPI link)
 *   BOARD_NET_UART_INSTANCE / BOARD_NET_UART_TX_PIN / BOARD_NET_UART_RX_PIN  (UART link)
 */

#include "board_tcp_client.h"

#include "board_config.h"

#include <stddef.h>
#include <stdint.h>

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

typedef struct {
    int connected;
    uint8_t rx_buffer[FRAME_MAX_SIZE];
    size_t rx_length;
} board_tcp_ctx_t;

static board_tcp_ctx_t g_tcp = {
    .connected = 0,
    .rx_length = 0,
};

/* -------------------------------------------------------------------------- */
/* HAL adaptation stubs                                                       */
/* -------------------------------------------------------------------------- */

/*
 * Replace these with your W7500P driver calls. The W7500P has a hardwired TCP/IP
 * stack: you initialize it, open a socket, connect to the server, then read/write
 * socket data over SPI or UART.
 */

static int hal_net_init(void)
{
#ifdef BOARD_NET_SPI_INSTANCE
    /*
     * SPI example:
     *   HAL_SPI_Init(&hspi1);                       /* BOARD_NET_SPI_INSTANCE *
     *   HAL_GPIO_WritePin(CS_PORT, CS_PIN, 1);      /* BOARD_NET_CS_PIN      *
     *   w7500p_init();
     */
#elif defined(BOARD_NET_UART_INSTANCE)
    /*
     * UART example:
     *   HAL_UART_Init(&huart2);                     /* BOARD_NET_UART_INSTANCE *
     *   w7500p_uart_init();
     */
#else
    #warning "No network role (NET_SPI or NET_UART) defined in board_config.h"
#endif
    return 0;
}

static int hal_net_connect(const char *address, uint16_t port)
{
    (void)address;
    (void)port;
    /*
     * HAL adaptation: open W7500P socket, connect to address:port.
     * Return 0 on success, nonzero on failure.
     */
    return 0;
}

static int hal_net_send(const uint8_t *bytes, size_t length)
{
    (void)bytes;
    (void)length;
    /*
     * HAL adaptation: write bytes to the W7500P socket.
     * Return 0 on success, nonzero on failure.
     */
    return 0;
}

static int hal_net_receive(uint8_t *buffer, size_t capacity, size_t *length, uint32_t timeout_ms)
{
    (void)buffer;
    (void)capacity;
    (void)length;
    (void)timeout_ms;
    /*
     * HAL adaptation: read one frame from the W7500P socket with timeout.
     * Fill buffer, set *length, return 0 on success, nonzero on timeout/error.
     */
    return -1;
}

/* -------------------------------------------------------------------------- */
/* tcp_client_t interface                                                     */
/* -------------------------------------------------------------------------- */

static tcp_client_error_t board_tcp_connect(void *context)
{
    (void)context;

    hal_net_init();

    if (hal_net_connect(CONFIG_SERVER_ADDRESS, (uint16_t)CONFIG_SERVER_PORT) != 0) {
        return TCP_CLIENT_ERROR_IO;
    }

    g_tcp.connected = 1;
    return TCP_CLIENT_OK;
}

static tcp_client_error_t board_tcp_send(void *context, const uint8_t *bytes, size_t length)
{
    (void)context;

    if (!g_tcp.connected) {
        return TCP_CLIENT_ERROR_DISCONNECTED;
    }

    if (hal_net_send(bytes, length) != 0) {
        g_tcp.connected = 0;
        return TCP_CLIENT_ERROR_IO;
    }

    return TCP_CLIENT_OK;
}

static tcp_client_error_t board_tcp_receive(
    void *context, uint8_t *buffer, size_t capacity, size_t *length, uint32_t timeout_ms)
{
    (void)context;

    if (!g_tcp.connected) {
        return TCP_CLIENT_ERROR_DISCONNECTED;
    }

    int result = hal_net_receive(buffer, capacity, length, timeout_ms);
    if (result != 0) {
        return TCP_CLIENT_ERROR_TIMEOUT;
    }

    return TCP_CLIENT_OK;
}

/* -------------------------------------------------------------------------- */
/* Interface table                                                            */
/* -------------------------------------------------------------------------- */

static const tcp_client_t board_tcp_client = {
    .context = &g_tcp,
    .connect = board_tcp_connect,
    .send = board_tcp_send,
    .receive = board_tcp_receive,
};

const tcp_client_t *board_tcp_client_get(void)
{
    return &board_tcp_client;
}
