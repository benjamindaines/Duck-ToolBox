import { onScopeDispose, ref, shallowRef } from "vue"

import type { KeyboxCompatibilityWarning, KeyboxTarget } from "@/core/features"

/** One page's pending keybox installation, cancelled when the page is left. */
export function useKeyboxInstallConfirmation() {
  const open = ref(false)
  const warning = shallowRef<KeyboxCompatibilityWarning | null>(null)
  let resolveConfirmation: ((accepted: boolean) => void) | undefined
  let disposed = false

  function respond(accepted: boolean) {
    open.value = false
    const resolve = resolveConfirmation
    resolveConfirmation = undefined
    resolve?.(accepted)
  }

  onScopeDispose(() => {
    disposed = true
    respond(false)
  })

  async function confirm(loadWarning?: () => Promise<KeyboxCompatibilityWarning | null>) {
    if (disposed || resolveConfirmation) return false
    const next = await loadWarning?.()
    if (disposed || resolveConfirmation) return false
    if (!next) return true
    warning.value = next
    const accepted = await new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve
      open.value = true
    })
    return accepted && !disposed
  }

  async function install(target: KeyboxTarget, sourcePath: string) {
    if (!(await confirm(() => target.compatibilityWarning?.() ?? Promise.resolve(null))))
      return null
    return target.install(sourcePath)
  }

  return { open, warning, respond, confirm, install }
}

export type KeyboxInstallConfirmation = ReturnType<typeof useKeyboxInstallConfirmation>
