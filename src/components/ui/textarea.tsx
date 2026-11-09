import * as React from "react"
import { cn } from "cn"
import { textareaClass } from './form-control-classes'

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        textareaClass,
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
