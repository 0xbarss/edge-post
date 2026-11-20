# Board configuration

Firmware settings that depend on the MCU and the PCB come from an STM32CubeMX `.ioc` project file. The `.ioc` file is the source of truth for the part, package, pin assignment, peripheral instances, and clock tree.

## Layout

```
firmware/boards/
  README.md
  .gitignore
  synthetic-demo/synthetic-demo.ioc   committed example
  <board>/<board>.ioc                 local, ignored
  <board>/board_config.h              generated, ignored
  boards.json                         generated, ignored
```

Each board directory holds exactly one `.ioc` file. The board name comes from `ProjectManager.ProjectName`, or from the file name when that key is absent.

Board sources and generated files are local by default. The synthetic example under `synthetic-demo/` is the only `.ioc` file tracked in Git; it exists so the generator, board selection, and dashboard catalog can be exercised without a real board. Do not force-add a private board source.

The backend parser tests use a separate fixture at `backend/tests/fixtures/synthetic-board.ioc`, so they do not depend on a board directory.

## Generate

From `firmware/`, with the backend dependencies installed:

```
make board
make board-check
```

`make board` writes `board_config.h` next to each `.ioc` file and rebuilds `boards.json`. `make board-check` compares the generated files with the local sources and exits non-zero when they differ or a file is missing; run `make board` first on a fresh checkout. The backend command behind both targets is `npm run board:generate`; both targets require Node and the backend `node_modules`.

Generated files are ignored by Git. A fresh clone therefore has no `boards.json`, and the backend catalog is empty until someone runs `make board` with the board sources present.

## Select a board

Name the board directory to add its header directory to the firmware include path:

```
make BOARD=<board> test
make BOARD=<board> board-select
```

Any source can then include `board_config.h`. `board-select` fails with a clear message when `BOARD` is unset or its generated header is missing. The host tests do not depend on a board, so they still run without `BOARD`.

## What the header contains

- MCU name, commercial part number, family, package, and firmware package version.
- System and HCLK frequencies, and the RTC clock source when CubeMX records them.
- Every assigned pin with its signal, GPIO label, and initial state.
- ADC channels with the pin and label for each channel.
- UART, SPI, and I2C instances with their signal pins.
- GPIO outputs and inputs with their labels.
- The role macros resolved from the label prefixes below.

The header is data, not board support code. HAL initialization, the W7500P transport, the temperature conversion, the server address, and the device ID are not present in an `.ioc` file and must be supplied by the board layer and `config.h`.

## Label conventions

CubeMX labels are the link between a pin and its role. Use these prefixes so the adapters can find the right pins without hardcoding a board:

- `TEMP_` on the ADC input used for temperature.
- `NET_` on the W7500P link pins, for example `NET_SCK`, `NET_MISO`, `NET_MOSI`, `NET_CS`, `NET_TX`, `NET_RX`.
- `OUT_` on GPIO outputs that the command layer may toggle.

The generator records every label, including ones that do not follow a convention. A board that omits a required label compiles, but the corresponding adapter role stays unassigned.

## Resolved roles

The generator turns the label prefixes into role macros in `board_config.h`:

| Role | Macros |
| --- | --- |
| Temperature | `BOARD_TEMP_ADC_INSTANCE`, `BOARD_TEMP_ADC_CHANNEL`, `BOARD_TEMP_ADC_PIN` |
| Network SPI | `BOARD_NET_SPI_INSTANCE`, `BOARD_NET_SPI_SCK_PIN`, `BOARD_NET_SPI_MISO_PIN`, `BOARD_NET_SPI_MOSI_PIN` |
| Network UART | `BOARD_NET_UART_INSTANCE`, `BOARD_NET_UART_TX_PIN`, `BOARD_NET_UART_RX_PIN` |
| Network chip select | `BOARD_NET_CS_PIN` |
| Controllable outputs | `BOARD_OUT_COUNT`, `BOARD_OUT<n>_PIN`, `BOARD_OUT<n>_LABEL` |

A role without a matching label is not defined, so adapters guard it with `#ifdef`. `BOARD_OUT_COUNT` is always defined and may be zero. Outputs keep the MCU pin order, and the command layer uses that index.

Generation fails when the labels are ambiguous: more than one `TEMP_` ADC channel, more than one `NET_` peripheral instance, `NET_` labels on both SPI and UART, or more than one `NET_CS` pin.

## Adding a board

1. Create the CubeMX project and set `ProjectManager.ProjectName` to the board name.
2. Put `firmware/boards/<board>/<board>.ioc` in place. It stays ignored by Git.
3. Run `make board` and then `make BOARD=<board> board-select`.
4. Do not commit the source or generated files. If a board is intentionally public, add an explicit negation to `firmware/boards/.gitignore` and commit the source and generated files together.
