import type { KeyboxCompatibilityWarning } from "@/core/features"

/** OMK versionCode is a Git commit count, so it cannot establish EC-only support. */
export function keyboxCompatibilityWarning(
  backend: string | undefined,
): KeyboxCompatibilityWarning | null {
  return backend === "oh-my-keymint"
    ? {
        titleKey: "trickyStore.keybox.omkCompatibilityTitle",
        descriptionKey: "trickyStore.keybox.omkCompatibilityDescription",
        confirmLabelKey: "trickyStore.keybox.continueInstall",
      }
    : null
}
