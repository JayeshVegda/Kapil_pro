import { Edit3, MoreHorizontal, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { buttonClass } from '@/components/ui/form-control-classes'

type ItemRowActionsProps = {
  name: string
  active: boolean
  onEdit: () => void
  onToggleActive: () => void
  onDelete: () => void
}

export function ItemRowActions({ name, active, onEdit, onToggleActive, onDelete }: ItemRowActionsProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button type="button" onClick={onEdit} className={`${buttonClass('secondary')} h-8 px-2 text-xs`}>
        <Edit3 size={14} /> Edit
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`More actions for ${name}`} className={`${buttonClass('secondary')} h-8 px-2 text-xs`}>
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onSelect={onToggleActive}>{active ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 size={14} /> Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
