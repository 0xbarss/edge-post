CC ?= cc
CFLAGS ?= -O2
CFLAGS += -std=c11 -Wall -Wextra -Wpedantic -Werror -Wshadow
SANITIZER_FLAGS ?= -fsanitize=address,undefined -fno-omit-frame-pointer
CPPFLAGS ?= -I.

BUILD_DIR := build
PRODUCT_SOURCES := frame.c command.c
FIRMWARE_HEADERS := $(wildcard *.h)
TEST_SOURCES := $(wildcard tests/*.c)
TEST_HEADERS := $(wildcard tests/*.h)
FORMAT_SOURCES := $(PRODUCT_SOURCES) $(FIRMWARE_HEADERS) $(TEST_SOURCES) $(TEST_HEADERS)
TEST_BINARIES := $(BUILD_DIR)/frame_test $(BUILD_DIR)/command_test

.PHONY: all test format format-check lint clean

all: test

test: $(TEST_BINARIES)
	./$(BUILD_DIR)/frame_test
	./$(BUILD_DIR)/command_test

$(BUILD_DIR)/frame_test: frame.c frame.h $(TEST_HEADERS) tests/frame_test.c
	@mkdir -p $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) $(SANITIZER_FLAGS) -o $@ frame.c tests/frame_test.c

$(BUILD_DIR)/command_test: frame.c command.c $(FIRMWARE_HEADERS) $(TEST_HEADERS) tests/command_test.c
	@mkdir -p $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) $(SANITIZER_FLAGS) -o $@ frame.c command.c tests/command_test.c

format:
	clang-format -i $(FORMAT_SOURCES)

format-check:
	clang-format --dry-run --Werror $(FORMAT_SOURCES)

lint:
	clang-tidy $(PRODUCT_SOURCES) $(TEST_SOURCES) -- $(CPPFLAGS) $(CFLAGS)

clean:
	rm -rf $(BUILD_DIR)
