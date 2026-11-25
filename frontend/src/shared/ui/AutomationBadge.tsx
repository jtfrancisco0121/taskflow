/** Marks a change made by an automation rule, next to the rule's name (DESIGN: automation-badge). */
export function AutomationBadge() {
  return (
    <span className="ml-1 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-status-done">
      Automation
    </span>
  )
}
