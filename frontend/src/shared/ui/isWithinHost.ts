/**
 * True when `node` is inside `host`, or inside a floating layer of the library (marked data-tf-floating).
 * A host with a focus-leave check (an inline editor) uses it instead of `host.contains(node)`: a Select's
 * listbox is portalled to document.body, so it is not a DOM descendant of the editor that opened it (AD-12).
 */
export function isWithinHost(host: Element | null, node: EventTarget | null): boolean {
  if (!(node instanceof Element)) return false
  return !!host?.contains(node) || node.closest('[data-tf-floating]') !== null
}
