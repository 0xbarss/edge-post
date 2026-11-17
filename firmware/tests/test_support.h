#ifndef EDGE_POST_TEST_SUPPORT_H
#define EDGE_POST_TEST_SUPPORT_H

#include <stdio.h>

static int test_failures;

static void test_check_impl(int condition, const char *expression, const char *file, int line) {
    if (condition == 0) {
        fprintf(stderr, "%s:%d: check failed: %s\n", file, line, expression);
        test_failures += 1;
    }
}

#define CHECK(condition) test_check_impl((condition) != 0, #condition, __FILE__, __LINE__)

/* Prints the failure summary and returns the process exit code. */
static int test_report(const char *suite) {
    if (test_failures != 0) {
        fprintf(stderr, "%d check(s) failed\n", test_failures);
        return 1;
    }

    printf("%s: all checks passed\n", suite);
    return 0;
}

#endif
