# Board configuration

Firmware settings that depend on the MCU and the PCB come from an STM32CubeMX `.ioc` project file. The `.ioc` file is the source of truth for the part, package, pin assignment, peripheral instances, and clock tree.

## Layout

```
firmware/boards/
  boards.json                 generated catalog read by the backend
  <board>/<board>.ioc         CubeMX project committed with the board
  <board>/board_config.h      generated C header; do not edit
```

Each board directory holds exactly one `.ioc` file. The board name comes from `ProjectManager.ProjectName`, or from the file name when that key is absent.

## Generate

From `firmware/`, with the backend dependencies installed:

```
make board
make board-check
```

`make board` writes `board_config.h` next to each `.ioc` file and rebuilds `boards.json`. `make board-check` compares the generated files with what is committed and exits non-zero when they differ. The backend command behind both targets is `npm run board:generate`; both targets require Node and the backend `node_modules`.

Generated files are committed so a firmware build does not need Node. Re-run `make board` after changing an `.ioc` file.

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

The header is data, not board support code. HAL initialization, the W7500P transport, the temperature conversion, the server address, and the device ID are not present in an `.ioc` file and must be supplied by the board layer and `config.h`.

## Label conventions

CubeMX labels are the link between a pin and its role. Use these prefixes so the adapters can find the right pins without hardcoding a board:

- `TEMP_` on the ADC input used for temperature.
- `NET_` on the W7500P link pins, for example `NET_SCK`, `NET_MISO`, `NET_MOSI`, `NET_CS`, `NET_TX`, `NET_RX`.
- `OUT_` on GPIO outputs that the command layer may toggle.

The generator records every label, including ones that do not follow a convention. A board that omits a required label compiles, but the corresponding adapter role stays unassigned.

## Adding a board

1. Create the CubeMX project and set `ProjectManager.ProjectName` to the board name.
2. Add `firmware/boards/<board>/<board>.ioc`. Commit it only if the file can be published with the repository.
3. Run `make board` and commit the generated `board_config.h` and `boards.json`.
4. Run `make board-check` in the review gate.
