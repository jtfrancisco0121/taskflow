import { useState } from 'react'
import { messageOf } from '../../api/errors'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { LocationIcon } from './LocationIcon'
import { useMoveLocation } from './useLocationMutations'
import { useTreeChildren, type TreeNode } from './useTreeChildren'

type MoveDialogProps = {
  workspaceId: string
  node: TreeNode
  onClose: () => void
  restoreFocus?: () => HTMLElement | null
}

type ParentOptionProps = {
  parent: TreeNode
  depth: number
  current: string | undefined
  selected: string | null
  onSelect: (id: string, ancestors: string[]) => void
}

function ParentOption({ parent, depth, current, selected, onSelect }: ParentOptionProps) {
  const isCurrent = parent.id === current
  return (
    <label
      className={`flex items-center gap-2 rounded py-1 pr-2 text-sm ${isCurrent ? 'text-slate-400' : 'hover:bg-slate-100'}`}
      style={{ paddingLeft: `${depth * 16 + 4}px` }}
    >
      <input
        type="radio"
        name="move-parent"
        value={parent.id}
        disabled={isCurrent}
        checked={selected === parent.id}
        onChange={() => onSelect(parent.id!, parent.parentId ? [parent.parentId] : [])}
      />
      <LocationIcon type={parent.type} />
      <span>{parent.name}</span>
      {isCurrent && <span className="text-xs">(current)</span>}
    </label>
  )
}

function SpaceBranch({
  workspaceId,
  space,
  withFolders,
  current,
  selected,
  onSelect,
}: {
  workspaceId: string
  space: TreeNode
  withFolders: boolean
  current: string | undefined
  selected: string | null
  onSelect: (id: string, ancestors: string[]) => void
}) {
  const children = useTreeChildren(workspaceId, space.id!, withFolders)
  const folders = withFolders
    ? (children.data ?? []).filter((child) => child.type === 'FOLDER')
    : []
  return (
    <>
      <ParentOption
        parent={space}
        depth={0}
        current={current}
        selected={selected}
        onSelect={onSelect}
      />
      {folders.map((folder) => (
        <ParentOption
          key={folder.id}
          parent={folder}
          depth={1}
          current={current}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}

/** FR-13: valid parents only (Spaces for a Folder; Spaces and Folders for a List), never the current one. */
export function MoveDialog({ workspaceId, node, onClose, restoreFocus }: MoveDialogProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedAncestors, setSelectedAncestors] = useState<string[]>([])
  const move = useMoveLocation(workspaceId)
  const spaces = useTreeChildren(workspaceId, 'root', true)
  const spaceNodes = (spaces.data ?? []).filter((n) => n.type === 'SPACE')

  return (
    <Dialog title={`Move ${node.name}`} onClose={onClose} restoreFocus={restoreFocus}>
      <fieldset className="mb-3 max-h-72 overflow-auto">
        <legend className="mb-1 text-sm text-slate-600">New parent</legend>
        {spaces.isPending && <p role="status">Loading…</p>}
        {spaceNodes.map((space) => (
          <SpaceBranch
            key={space.id}
            workspaceId={workspaceId}
            space={space}
            withFolders={node.type === 'LIST'}
            current={node.parentId}
            selected={selected}
            onSelect={(id, ancestors) => {
              setSelected(id)
              setSelectedAncestors(ancestors)
            }}
          />
        ))}
      </fieldset>
      {move.isError && (
        <p role="alert" className="mb-2 text-sm text-red-700">
          {messageOf(move.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!selected || move.isPending}
          onClick={() =>
            move.mutate(
              { id: node.id!, parentId: selected!, expand: selectedAncestors },
              { onSuccess: () => onClose() },
            )
          }
        >
          Move
        </Button>
      </div>
    </Dialog>
  )
}
