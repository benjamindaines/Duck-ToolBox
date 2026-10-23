// SPDX-License-Identifier: GPL-3.0-only
// Play Integrity Fork derivative, revision 23ec56c; modified 2026-10-23:
// bounded, ABI-independent companion transport and independent engine storage.
#pragma once
#include <cstdint>
#include <vector>
#include <string>
#include "json/single_include/nlohmann/json.hpp"
namespace pif {
constexpr uint32_t magic = 0x50494631;
constexpr uint32_t max_dex = 16 * 1024 * 1024;
constexpr uint32_t max_config = 64 * 1024;
bool transfer(int fd, void *buffer, size_t size, bool writing);
bool receive(int fd, std::vector<char> &dex, std::string &config);
void companion(int fd);
nlohmann::json parse(const std::string &raw);
int number(const nlohmann::json &value, int fallback);
}
