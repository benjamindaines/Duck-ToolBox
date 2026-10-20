import { useMutation, useQueryClient } from "@tanstack/vue-query"

import { useKeyboxInstallConfirmation } from "@/core/keybox"
import { notifySuccess } from "@/core/notify"

import type { KeyboxInstall } from "./api"
import { trickyStoreApi } from "./api"
import { useTrickyI18n } from "./i18n"
import { keyboxCompatibilityWarning } from "./keybox-compatibility"
import { STATUS_KEY } from "./queries"

type Messages = Parameters<ReturnType<typeof useTrickyI18n>["t"]>[0]

/**
 * Installing a keybox from any source: Tricky Addon's success and failure messages, the
 * written path, and a refreshed keybox status.
 */
export function useKeyboxInstall<Input>(
  run: (input: Input) => Promise<KeyboxInstall>,
  options: { success: Messages; failure?: Messages; bundled?: boolean },
) {
  const { t } = useTrickyI18n()
  const client = useQueryClient()
  const compatibility = useKeyboxInstallConfirmation()
  const mutation = useMutation({
    mutationFn: async (input: Input) => {
      if (
        !options.bundled &&
        !(await compatibility.confirm(async () => {
          const status = await client.fetchQuery({
            queryKey: STATUS_KEY,
            queryFn: trickyStoreApi.status,
            staleTime: 0,
          })
          return keyboxCompatibilityWarning(status.active?.backend)
        }))
      )
        return null
      return run(input)
    },
    meta: { errorTitle: () => t(options.failure ?? "ta.prompt_key_set_error") },
    onSuccess: (result) => {
      if (!result) return
      const detail = [
        t("keybox.installedDetail", { count: result.summary.keyboxes, path: result.target_path }),
        result.backup_path ? t("keybox.backup", { path: result.backup_path }) : "",
      ]
      notifySuccess(t(options.success), detail.filter(Boolean).join("\n"))
      void client.invalidateQueries({ queryKey: STATUS_KEY })
    },
  })
  return { ...mutation, compatibility }
}
