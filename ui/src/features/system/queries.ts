import { useQuery } from "@tanstack/vue-query"

import { bridge } from "@/core/bridge"

import { systemApi } from "./api"

export function useSystemInfo() {
  return useQuery({
    queryKey: ["system.info"],
    queryFn: systemApi.info,
    enabled: bridge().available,
    staleTime: 5 * 60_000,
  })
}
