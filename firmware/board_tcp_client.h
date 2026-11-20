#ifndef EDGE_POST_BOARD_TCP_CLIENT_H
#define EDGE_POST_BOARD_TCP_CLIENT_H

#include "tcp_client.h"

/*
 * Board TCP client implementation.
 *
 * Adapts the W7500P (over SPI or UART per board_config.h role macros) into the
 * edge-post tcp_client_t contract. Network role macros come from board_config.h:
 *
 *   BOARD_NET_SPI_* / BOARD_NET_CS_PIN    (SPI link to W7500P)
 *   BOARD_NET_UART_*                        (UART link to W7500P)
 *
 * Include board_config.h before this header.
 */

#ifdef __cplusplus
extern "C" {
#endif

/* Returns a tcp_client_t configured from the board's network role macros. */
const tcp_client_t *board_tcp_client_get(void);

#ifdef __cplusplus
}
#endif

#endif /* EDGE_POST_BOARD_TCP_CLIENT_H */
