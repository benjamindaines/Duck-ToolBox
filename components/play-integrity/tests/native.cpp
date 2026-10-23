// SPDX-License-Identifier: GPL-3.0-only
// Independent native parser and companion protocol verification.
#include "transport.hpp"
#include <cassert>
#include <thread>
#include <sys/socket.h>
#include <unistd.h>
static void closePair(int (&fd)[2]) { close(fd[0]); close(fd[1]); }
int main() {
    auto parsed = pif::parse("MODEL=with \"quotes\"\n*.security_patch=2026-10-05");
    assert(parsed["MODEL"] == "with \"quotes\"");
    assert(parsed["*.security_patch"] == "2026-10-05");
    assert(pif::parse("{\"MODEL\":[]}").empty());
    assert(pif::parse("{broken").empty());
    auto scalars = pif::parse("{\"spoofBuild\":true,\"SDK_INT\":36,\"EXTRA\":null}");
    assert(scalars["spoofBuild"] == "1" && scalars["SDK_INT"] == "36" && scalars["EXTRA"] == "");
    assert(pif::parse("{\"MODEL\":\"bad\\nvalue\"}").empty());
    assert(pif::number("2147483648", 0) == 0);
    assert(pif::number("1tail", 0) == 0);
    assert(pif::number("100", 0) == 100);
    int fd[2]; assert(socketpair(AF_UNIX, SOCK_STREAM, 0, fd) == 0);
    std::thread writer([&] {
        uint32_t header[]{pif::magic, 3, 2};
        auto *bytes = reinterpret_cast<char *>(header);
        for (size_t i = 0; i < sizeof(header); ++i) assert(write(fd[1], bytes+i, 1) == 1);
        assert(write(fd[1], "dex{}", 5) == 5);
    });
    std::vector<char> dex; std::string config;
    assert(pif::receive(fd[0], dex, config)); assert(dex.size() == 3 && config == "{}");
    writer.join(); closePair(fd);
    assert(socketpair(AF_UNIX, SOCK_STREAM, 0, fd) == 0);
    uint32_t tooLarge[]{pif::magic, pif::max_dex+1, 1};
    assert(write(fd[1], tooLarge, sizeof(tooLarge)) == sizeof(tooLarge));
    assert(!pif::receive(fd[0], dex, config)); closePair(fd);
    assert(socketpair(AF_UNIX, SOCK_STREAM, 0, fd) == 0);
    assert(write(fd[1], "bad", 3) == 3); close(fd[1]);
    assert(!pif::receive(fd[0], dex, config)); close(fd[0]);
}
