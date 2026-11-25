import * as SwitchPrimitive from '@radix-ui/react-switch'

type SwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label?: string
  id?: string
  'aria-label'?: string
  disabled?: boolean
}

export function Switch({ checked, onCheckedChange, label, id, disabled, ...aria }: SwitchProps) {
  const control = (
    <SwitchPrimitive.Root
      id={id}
      aria-label={aria['aria-label']}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className="relative h-5 w-9 shrink-0 rounded-full bg-surface-3 transition-colors duration-(--tf-dur-fast) data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-surface shadow transition-transform duration-(--tf-dur-fast) data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  )
  if (!label) return control
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-fg">
      {control}
      {label}
    </label>
  )
}
