#ifndef EDGE_POST_CONFIG_H
#define EDGE_POST_CONFIG_H

/*
 * Compile-time defaults for the device. Override any value with a compiler definition, for
 * example -DCONFIG_DEVICE_ID=42. The server address, port, and device ID describe a deployment
 * and are not secrets.
 */

#ifndef CONFIG_DEVICE_ID
#define CONFIG_DEVICE_ID 1u
#endif

#ifndef CONFIG_SAMPLE_RATE_SECONDS
#define CONFIG_SAMPLE_RATE_SECONDS 5u
#endif

#ifndef CONFIG_SERVER_ADDRESS
#define CONFIG_SERVER_ADDRESS "192.168.1.10"
#endif

#ifndef CONFIG_SERVER_PORT
#define CONFIG_SERVER_PORT 9000u
#endif

#ifndef CONFIG_POLL_TIMEOUT_MS
#define CONFIG_POLL_TIMEOUT_MS 2000u
#endif

#ifndef CONFIG_RECONNECT_INITIAL_DELAY_MS
#define CONFIG_RECONNECT_INITIAL_DELAY_MS 1000u
#endif

#ifndef CONFIG_RECONNECT_MAX_DELAY_MS
#define CONFIG_RECONNECT_MAX_DELAY_MS 30000u
#endif

#if CONFIG_DEVICE_ID < 1 || CONFIG_DEVICE_ID > 65535
#error "CONFIG_DEVICE_ID must be between 1 and 65535"
#endif

#if CONFIG_SAMPLE_RATE_SECONDS < 1 || CONFIG_SAMPLE_RATE_SECONDS > 255
#error "CONFIG_SAMPLE_RATE_SECONDS must be between 1 and 255"
#endif

#if CONFIG_SERVER_PORT < 1 || CONFIG_SERVER_PORT > 65535
#error "CONFIG_SERVER_PORT must be between 1 and 65535"
#endif

#if CONFIG_POLL_TIMEOUT_MS < 1
#error "CONFIG_POLL_TIMEOUT_MS must be positive"
#endif

#if CONFIG_RECONNECT_INITIAL_DELAY_MS < 1
#error "CONFIG_RECONNECT_INITIAL_DELAY_MS must be positive"
#endif

#if CONFIG_RECONNECT_MAX_DELAY_MS < CONFIG_RECONNECT_INITIAL_DELAY_MS
#error "CONFIG_RECONNECT_MAX_DELAY_MS must not be shorter than CONFIG_RECONNECT_INITIAL_DELAY_MS"
#endif

#endif
