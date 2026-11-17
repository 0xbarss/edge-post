CC ?= cc
CFLAGS ?= -O2
CFLAGS += -std=c11 -Wall -Wextra -Wpedantic -Werror -Wshadow
SANITIZER_FLAGS ?= -fsanitize=address,undefined -fno-omit-frame-pointer
CPPFLAGS ?= -I.

BUILD_DIR := build
FRAME_SOURCES := frame.c
TEST_SOURCES := tests/frame_test.c
FORMAT_SOURCES := frame.c frame.h tests/frame_test.c

.PHONY: all test format format-check lint clean

all: test

test: $(BUILD_DIR)/frame_test
	./$(BUILD_DIR)/frame_test

$(BUILD_DIR)/frame_test: $(FRAME_SOURCES) $(TEST_SOURCES) frame.h
	@mkdir -p $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) $(SANITIZER_FLAGS) -o $@ $(FRAME_SOURCES) $(TEST_SOURCES)

format:
	clang-format -i $(FORMAT_SOURCES)

format-check:
	clang-format --dry-run --Werror $(FORMAT_SOURCES)

lint:
	clang-tidy $(FRAME_SOURCES) $(TEST_SOURCES) -- $(CPPFLAGS) $(CFLAGS)

clean:
	rm -rf $(BUILD_DIR)
